import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { fixAndValidateStructuredOutput } from 'react-native-executorch';
import { z } from 'zod';
import {
  buildLlmInferenceSample,
  recordLlmInferenceLatency,
} from './commandLatency';
import { useOnDeviceAI } from './OnDeviceAIProvider';
import { parseValidActions } from './parseAgentActions';
import { splitSaveUtterance } from './splitSaveUtterance';
import { TRANSCRIPT_CHUNK_INTERVAL_MS } from './transcriptDelta';
import {
  flushPendingAction,
  ingestPendingAction,
} from './actionHypothesis';

interface QueuedUtterance {
  text: string;
  finalize: boolean;
}

const SILENCE_TIMEOUT_MS = 60_000;
const COMMAND_STATUS_DISPLAY_MS = 2500;

const SPEECH_RECOGNITION_OPTIONS = {
  lang: 'en-IN',
  interimResults: true,
  continuous: true,
  requiresOnDeviceRecognition: true,
  addsPunctuation: false,
  androidIntentOptions: {
    EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: SILENCE_TIMEOUT_MS,
    EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS:
      SILENCE_TIMEOUT_MS,
  },
} as const;

const RECOVERABLE_SPEECH_ERRORS = new Set([
  'aborted',
  'busy',
  'client',
  'interrupted',
  'network',
  'no-speech',
  'speech-timeout',
  'unknown',
]);

export interface CommandStatus {
  message: string;
  isError: boolean;
}

export interface VoiceAgentApplyResult {
  label: string;
  /** When false, do not store this response as the next-turn LLM context. */
  updateContext?: boolean;
}

interface UseVoiceAgentOptions<TItem extends { action: string }> {
  itemSchema: z.ZodType<TItem>;
  getSystemPrompt: () => string;
  applyResponse: (
    response: TItem[],
  ) => VoiceAgentApplyResult | null | Promise<VoiceAgentApplyResult | null>;
  isIncomplete: (response: TItem[]) => boolean;
  isUnknown: (response: TItem[]) => boolean;
  /** Fallback draft/item identity when there is no prior LLM response yet. */
  getAssistantContext?: () => TItem[] | null;
}

export function useVoiceAgent<TItem extends { action: string }>(
  options: UseVoiceAgentOptions<TItem>,
) {
  const { llm } = useOnDeviceAI();

  const [isSessionActive, setIsSessionActive] = useState(false);
  const [heardText, setHeardText] = useState('');
  const [commandStatus, setCommandStatus] = useState<CommandStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionActiveRef = useRef(false);
  const committedTextRef = useRef('');
  const interimTranscriptRef = useRef('');
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRequestedRef = useRef(false);
  const startAfterEndRef = useRef(false);
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
        // Emit each token so TTFT measures the first visible model token,
        // rather than the first larger token batch.
        outputTokenBatchSize: 1,
      },
    });
  }, [llm.isReady, llm.configure]);

  const modelsReady = llm.isReady;
  const downloadProgress = llm.downloadProgress;
  const modelError = llm.error?.message ?? null;

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
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

      const applyActions = async (actions: TItem[]) => {
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
        if (applied.updateContext !== false) {
          lastSuccessfulAgentResponseRef.current = actions;
        }
        showStatus(`Applied: ${applied.label}`, false);
      };

      let incoming: TItem[] | null = null;

      if (utterance) {
        const alreadyGenerated = utterance === lastLlmUtteranceRef.current;
        if (!alreadyGenerated) {
          console.log('[LLM] utterance:', utterance);
          try {
            setCommandStatus({ message: 'Running on-device LLM…', isError: false });

            const lastAgentResponse =
              lastSuccessfulAgentResponseRef.current ??
              optionsRef.current.getAssistantContext?.();
            if (lastAgentResponse) {
              console.log(
                '[LLM] assistant context sent:',
                JSON.stringify(lastAgentResponse),
              );
            } else {
              console.log('[LLM] assistant context sent: none');
            }
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
            const startedAt = Date.now();
            let firstTokenAt: number | null = null;
            const reply = await currentLlm.generate(messages, () => {
              firstTokenAt ??= Date.now();
            });
            const finishedAt = Date.now();

            let promptTokenCount: number | null = null;
            let generatedTokenCount: number | null = null;
            let totalTokenCount: number | null = null;
            try {
              promptTokenCount = currentLlm.getPromptTokenCount();
              generatedTokenCount = currentLlm.getGeneratedTokenCount();
              totalTokenCount = currentLlm.getTotalTokenCount();
            } catch (tokenCountError) {
              console.warn('[latency] failed to read token counts', tokenCountError);
            }

            const sample = buildLlmInferenceSample({
              utterance,
              startedAt,
              finishedAt,
              firstTokenAt,
              promptTokenCount,
              generatedTokenCount,
              totalTokenCount,
            });
            if (sample) {
              console.log('[latency] inference metrics:', {
                inferenceMs: sample.inferenceMs,
                ttftMs: sample.ttftMs,
                promptTokenCount: sample.promptTokenCount,
                generatedTokenCount: sample.generatedTokenCount,
                totalTokenCount: sample.totalTokenCount,
              });
              recordLlmInferenceLatency(sample);
            }
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

      if (incoming) {
        const ingested = ingestPendingAction<TItem>(
          pendingActionRef.current,
          incoming,
          appliedActionsRef.current,
        );
        pendingActionRef.current = ingested.pending;
        await applyActions(ingested.toApply);
      }

      if (queued.finalize) {
        const remaining = flushPendingAction(
          pendingActionRef.current,
          appliedActionsRef.current,
        );
        pendingActionRef.current = null;
        await applyActions(remaining);
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

  const startSpeechRecognition = useCallback(() => {
    ExpoSpeechRecognitionModule.start(SPEECH_RECOGNITION_OPTIONS);
  }, []);

  const endSession = useCallback(() => {
    if (!sessionActiveRef.current) {
      return;
    }
    stopRequestedRef.current = true;
    startAfterEndRef.current = false;
    sessionActiveRef.current = false;
    setIsSessionActive(false);
    clearChunkTimer();
    flushTranscriptDelta(true);
    clearSilenceTimer();
    ExpoSpeechRecognitionModule.stop();
  }, [clearChunkTimer, clearSilenceTimer, flushTranscriptDelta]);

  const scheduleSilenceTimeout = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(endSession, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, endSession]);

  useSpeechRecognitionEvent('result', (event) => {
    if (!sessionActiveRef.current) return;

    const transcript = event.results[0]?.transcript ?? '';
    if (transcript.trim()) {
      scheduleSilenceTimeout();
    }

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

  useSpeechRecognitionEvent('speechstart', () => {
    if (sessionActiveRef.current) {
      scheduleSilenceTimeout();
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!sessionActiveRef.current) {
      return;
    }
    if (RECOVERABLE_SPEECH_ERRORS.has(event.error)) {
      return;
    }
    endSession();
    setErrorMessage(`Speech recognition failed: ${event.message}`);
  });

  useSpeechRecognitionEvent('end', () => {
    if (stopRequestedRef.current) {
      stopRequestedRef.current = false;
      if (startAfterEndRef.current && sessionActiveRef.current) {
        startAfterEndRef.current = false;
        startSpeechRecognition();
      }
      return;
    }
    if (!sessionActiveRef.current) {
      return;
    }
    if (interimTranscriptRef.current.trim()) {
      flushTranscriptDelta(true);
    }
    startSpeechRecognition();
  });

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      clearChunkTimer();
      clearUtteranceQueue();
      if (commandStatusTimerRef.current) {
        clearTimeout(commandStatusTimerRef.current);
      }
      if (sessionActiveRef.current) {
        stopRequestedRef.current = true;
        sessionActiveRef.current = false;
        ExpoSpeechRecognitionModule.stop();
      }
    };
  }, [clearSilenceTimer, clearChunkTimer, clearUtteranceQueue]);

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
    scheduleSilenceTimeout();
    clearChunkTimer();
    chunkTimerRef.current = setInterval(
      () => flushTranscriptDelta(false),
      TRANSCRIPT_CHUNK_INTERVAL_MS,
    );

    if (stopRequestedRef.current) {
      startAfterEndRef.current = true;
    } else {
      startSpeechRecognition();
    }
  }, [
    modelsReady,
    clearTranscript,
    clearUtteranceQueue,
    clearAgentContext,
    scheduleSilenceTimeout,
    clearChunkTimer,
    flushTranscriptDelta,
    startSpeechRecognition,
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
