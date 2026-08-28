import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { fixAndValidateStructuredOutput } from 'react-native-executorch';
import { z } from 'zod';
import {
  buildCommandLatencySample,
  recordCommandLatency,
} from './commandLatency';
import { useOnDeviceAI } from './OnDeviceAIProvider';
import { parseValidActions } from './parseAgentActions';
import { splitSaveUtterance } from './splitSaveUtterance';
import { TRANSCRIPT_CHUNK_INTERVAL_MS } from './transcriptDelta';
import {
  flushPendingAction,
  ingestPendingAction,
  isActionItem,
  isActionList,
} from './actionHypothesis';

interface QueuedUtterance {
  text: string;
  finalize: boolean;
}

const MAX_SESSION_DURATION_MS = 60000;
const COMMAND_STATUS_DISPLAY_MS = 2500;

export interface CommandStatus {
  message: string;
  isError: boolean;
}

export interface VoiceAgentApplyResult {
  label: string;
  /** When false, do not store this response as the next-turn LLM context. */
  updateContext?: boolean;
}

interface UseVoiceAgentOptions<TItem> {
  itemSchema: z.ZodType<TItem>;
  getSystemPrompt: () => string;
  applyResponse: (
    response: TItem[],
  ) => VoiceAgentApplyResult | null | Promise<VoiceAgentApplyResult | null>;
  isIncomplete: (response: TItem[]) => boolean;
  isUnknown: (response: TItem[]) => boolean;
  /** Current draft/item identity to send as previous-assistant JSON. */
  getAssistantContext?: () => TItem[] | null;
}

export function useVoiceAgent<TItem>(options: UseVoiceAgentOptions<TItem>) {
  const { llm } = useOnDeviceAI();

  const [isSessionActive, setIsSessionActive] = useState(false);
  const [heardText, setHeardText] = useState('');
  const [commandStatus, setCommandStatus] = useState<CommandStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionActiveRef = useRef(false);
  const committedTextRef = useRef('');
  const interimTranscriptRef = useRef('');
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const llmRef = useRef(llm);
  const utteranceQueueRef = useRef<QueuedUtterance[]>([]);
  const isProcessingQueueRef = useRef(false);
  const lastSuccessfulAgentResponseRef = useRef<TItem[] | null>(null);
  const lastLlmUtteranceRef = useRef('');
  const pendingActionRef = useRef<TItem | null>(null);
  const appliedActionsRef = useRef<TItem[]>([]);
  const optionsRef = useRef(options);

  useEffect(() => {
    llmRef.current = llm;
  }, [llm]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!llm.isReady) {
      return;
    }
    llm.configure({
      generationConfig: {
        temperature: 0,
      },
    });
  }, [llm.isReady, llm.configure]);

  const modelsReady = llm.isReady;
  const downloadProgress = llm.downloadProgress;
  const modelError = llm.error?.message ?? null;

  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  const clearTranscript = useCallback(() => {
    committedTextRef.current = '';
    interimTranscriptRef.current = '';
    setHeardText('');
  }, []);

  const currentUtterance = useCallback(() => {
    return interimTranscriptRef.current.trim();
  }, []);

  const clearUtteranceQueue = useCallback(() => {
    utteranceQueueRef.current = [];
  }, []);

  const clearHypothesis = useCallback(() => {
    lastLlmUtteranceRef.current = '';
    pendingActionRef.current = null;
    appliedActionsRef.current = [];
  }, []);

  const clearAgentContext = useCallback(() => {
    lastSuccessfulAgentResponseRef.current = null;
    clearHypothesis();
  }, [clearHypothesis]);

  const scheduleCommandStatusClear = useCallback(() => {
    if (commandStatusTimerRef.current) {
      clearTimeout(commandStatusTimerRef.current);
    }
    commandStatusTimerRef.current = setTimeout(() => {
      setCommandStatus(null);
    }, COMMAND_STATUS_DISPLAY_MS);
  }, []);

  const showStatus = useCallback(
    (message: string, isError: boolean) => {
      setCommandStatus({ message, isError });
      scheduleCommandStatusClear();
    },
    [scheduleCommandStatusClear],
  );

  const processUtterance = useCallback(
    async (queued: QueuedUtterance) => {
      const currentLlm = llmRef.current;
      if (!currentLlm.isReady) {
        return;
      }

      const utterance = queued.text.trim();
      const {
        itemSchema,
        getSystemPrompt,
        applyResponse,
        isIncomplete,
        isUnknown,
      } = optionsRef.current;

      const applyActions = async (
        actions: TItem[],
        llmStartedAt: number,
      ) => {
        if (actions.length === 0) {
          return;
        }
        const applied = await applyResponse(actions);
        if (!applied) {
          showStatus('Could not apply command', true);
          return;
        }
        appliedActionsRef.current = [
          ...appliedActionsRef.current,
          ...actions,
        ];
        const sample = buildCommandLatencySample({
          utterance: utterance || queued.text,
          appliedLabel: applied.label,
          llmStartedAt,
          appliedAt: Date.now(),
        });
        if (sample) {
          console.log('[latency] llm to apply ms:', sample.llmToApplyMs);
          recordCommandLatency(sample);
        }
        if (applied.updateContext !== false) {
          lastSuccessfulAgentResponseRef.current = actions;
        }
        showStatus(`Applied: ${applied.label}`, false);
      };

      const llmStartedAt = Date.now();
      let incoming: TItem[] | null = null;

      if (utterance) {
        const alreadyGenerated = utterance === lastLlmUtteranceRef.current;
        if (!alreadyGenerated) {
          console.log('[LLM] utterance:', utterance);
          try {
            setCommandStatus({ message: 'Running on-device LLM…', isError: false });

            const lastAgentResponse =
              optionsRef.current.getAssistantContext?.() ??
              lastSuccessfulAgentResponseRef.current;
            const messages = [
              { role: 'system' as const, content: getSystemPrompt() },
              ...(lastAgentResponse
                ? [
                    {
                      role: 'assistant' as const,
                      content: JSON.stringify(lastAgentResponse),
                    },
                  ]
                : []),
              { role: 'user' as const, content: utterance },
            ];
            const reply = await currentLlm.generate(messages);
            console.log('[LLM] response:', reply);
            lastLlmUtteranceRef.current = utterance;

            let parsed: unknown | undefined;
            let parsedOk = false;
            try {
              parsed = fixAndValidateStructuredOutput(reply, z.unknown());
              parsedOk = true;
            } catch {
              parsed = undefined;
            }

            const formattedResponse =
              parsedOk && parsed !== undefined
                ? parseValidActions(parsed, itemSchema)
                : null;
            if (!formattedResponse) {
              showStatus('Could not parse LLM response', true);
            } else if (isIncomplete(formattedResponse)) {
              incoming = null;
            } else if (isUnknown(formattedResponse)) {
              showStatus('Unknown command', true);
            } else {
              incoming = formattedResponse;
            }
          } catch {
            showStatus('LLM inference failed', true);
          }
        }
      }

      if (incoming && isActionList(incoming)) {
        const pending = isActionItem(pendingActionRef.current)
          ? pendingActionRef.current
          : null;
        const ingested = ingestPendingAction(
          pending,
          incoming,
          appliedActionsRef.current,
        );
        pendingActionRef.current = ingested.pending as TItem | null;
        await applyActions(ingested.toApply as TItem[], llmStartedAt);
      } else if (incoming && queued.finalize) {
        await applyActions(incoming, llmStartedAt);
      }

      if (queued.finalize) {
        const remaining = flushPendingAction(
          pendingActionRef.current,
          appliedActionsRef.current,
        );
        pendingActionRef.current = null;
        await applyActions(remaining, llmStartedAt);
        appliedActionsRef.current = [];
        lastLlmUtteranceRef.current = '';
      }
    },
    [showStatus],
  );

  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) {
      return;
    }

    isProcessingQueueRef.current = true;
    try {
      while (utteranceQueueRef.current.length > 0) {
        const next = utteranceQueueRef.current.shift();
        if (!next) {
          continue;
        }
        await processUtterance(next);
      }
    } finally {
      isProcessingQueueRef.current = false;
      if (utteranceQueueRef.current.length > 0) {
        void processQueue();
      }
    }
  }, [processUtterance]);

  const enqueueUtterance = useCallback(
    (snapshot: string, finalize: boolean) => {
      if (!llmRef.current.isReady) {
        return;
      }

      const input = snapshot.trim();
      if (!input && !finalize) {
        return;
      }

      if (!finalize) {
        const last =
          utteranceQueueRef.current[utteranceQueueRef.current.length - 1];
        if (last && !last.finalize) {
          last.text = input;
        } else {
          utteranceQueueRef.current.push({ text: input, finalize: false });
        }
      } else {
        const last =
          utteranceQueueRef.current[utteranceQueueRef.current.length - 1];
        if (last && !last.finalize && last.text.trim() === input) {
          last.finalize = true;
        } else {
          const segments = !input ? [''] : splitSaveUtterance(input);
          const parts = segments.length > 0 ? segments : [''];
          parts.forEach((text, index) => {
            utteranceQueueRef.current.push({
              text,
              finalize: index === parts.length - 1,
            });
          });
        }
      }

      if (isProcessingQueueRef.current) {
        const pending = utteranceQueueRef.current.length;
        setCommandStatus({
          message: `Queued (${pending} waiting)…`,
          isError: false,
        });
      }

      void processQueue();
    },
    [processQueue],
  );

  const enqueueUtteranceRef = useRef(enqueueUtterance);
  useEffect(() => {
    enqueueUtteranceRef.current = enqueueUtterance;
  }, [enqueueUtterance]);

  const flushTranscriptDelta = useCallback(
    (finalize = false, finalTranscript?: string) => {
      const snapshot = (
        finalize
          ? (finalTranscript ?? currentUtterance())
          : currentUtterance()
      ).trim();
      if (!snapshot && !finalize) {
        return;
      }
      enqueueUtteranceRef.current(snapshot, finalize);
    },
    [currentUtterance],
  );

  const clearChunkTimer = useCallback(() => {
    if (chunkTimerRef.current) {
      clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
  }, []);

  const endSession = useCallback(() => {
    if (!sessionActiveRef.current) {
      return;
    }
    sessionActiveRef.current = false;
    setIsSessionActive(false);
    clearChunkTimer();
    flushTranscriptDelta(true);
    clearSafetyTimer();
    ExpoSpeechRecognitionModule.stop();
  }, [clearChunkTimer, clearSafetyTimer, flushTranscriptDelta]);

  const scheduleSafetyCap = useCallback(() => {
    clearSafetyTimer();
    safetyTimerRef.current = setTimeout(endSession, MAX_SESSION_DURATION_MS);
  }, [clearSafetyTimer, endSession]);

  useSpeechRecognitionEvent('result', (event) => {
    if (!sessionActiveRef.current) return;

    const transcript = event.results[0]?.transcript ?? '';

    if (event.isFinal) {
      committedTextRef.current += transcript + ' ';
      interimTranscriptRef.current = '';
      setHeardText(committedTextRef.current.trim());
      flushTranscriptDelta(true, transcript);
    } else {
      interimTranscriptRef.current = transcript;
      setHeardText((committedTextRef.current + transcript).trim());
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (sessionActiveRef.current) {
      endSession();
      setErrorMessage(`Speech recognition failed: ${event.message}`);
    }
  });

  useSpeechRecognitionEvent('end', () => {
    if (sessionActiveRef.current) {
      endSession();
    }
  });

  useEffect(() => {
    return () => {
      clearSafetyTimer();
      clearChunkTimer();
      clearUtteranceQueue();
      if (commandStatusTimerRef.current) {
        clearTimeout(commandStatusTimerRef.current);
      }
      if (sessionActiveRef.current) {
        sessionActiveRef.current = false;
        ExpoSpeechRecognitionModule.stop();
      }
    };
  }, [clearSafetyTimer, clearChunkTimer, clearUtteranceQueue]);

  const startSession = useCallback(async () => {
    if (!modelsReady) {
      setErrorMessage('On-device LLM is still loading. Please wait.');
      return;
    }

    const { granted } =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      setErrorMessage('Microphone and speech recognition permissions are required.');
      return;
    }

    clearTranscript();
    clearUtteranceQueue();
    clearAgentContext();
    setErrorMessage(null);
    setCommandStatus(null);

    sessionActiveRef.current = true;
    setIsSessionActive(true);
    scheduleSafetyCap();
    clearChunkTimer();
    chunkTimerRef.current = setInterval(
      () => flushTranscriptDelta(false),
      TRANSCRIPT_CHUNK_INTERVAL_MS,
    );

    ExpoSpeechRecognitionModule.start({
      lang: 'en-IN',
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: false,
    });
  }, [
    modelsReady,
    clearTranscript,
    clearUtteranceQueue,
    clearAgentContext,
    scheduleSafetyCap,
    clearChunkTimer,
    flushTranscriptDelta,
  ]);

  const handleMicPress = useCallback(() => {
    if (isSessionActive) {
      endSession();
    } else {
      void startSession();
    }
  }, [isSessionActive, endSession, startSession]);

  return {
    isSessionActive,
    heardText,
    commandStatus,
    errorMessage,
    modelsReady,
    downloadProgress,
    modelError,
    handleMicPress,
    endSession,
    clearAgentContext,
    showStatus,
  };
}
