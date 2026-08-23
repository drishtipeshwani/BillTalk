import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { fixAndValidateStructuredOutput } from 'react-native-executorch';
import type { z } from 'zod';
import { useOnDeviceAI } from './OnDeviceAIProvider';
import { splitSaveUtterance } from './splitSaveUtterance';

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

interface UseVoiceAgentOptions<T> {
  schema: z.ZodType<T>;
  getSystemPrompt: () => string;
  applyResponse: (
    response: T,
  ) => VoiceAgentApplyResult | null | Promise<VoiceAgentApplyResult | null>;
  isIncomplete: (response: T) => boolean;
  isUnknown: (response: T) => boolean;
}

export function useVoiceAgent<T>(options: UseVoiceAgentOptions<T>) {
  const { llm } = useOnDeviceAI();

  const [isSessionActive, setIsSessionActive] = useState(false);
  const [heardText, setHeardText] = useState('');
  const [commandStatus, setCommandStatus] = useState<CommandStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionActiveRef = useRef(false);
  const committedTextRef = useRef('');
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const llmRef = useRef(llm);
  const utteranceQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef(false);
  const lastSuccessfulAgentResponseRef = useRef<T | null>(null);
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
    setHeardText('');
  }, []);

  const clearUtteranceQueue = useCallback(() => {
    utteranceQueueRef.current = [];
  }, []);

  const clearAgentContext = useCallback(() => {
    lastSuccessfulAgentResponseRef.current = null;
  }, []);

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
    async (input: string) => {
      const currentLlm = llmRef.current;
      if (!currentLlm.isReady) {
        return;
      }

      console.log('[LLM] utterance:', input);

      try {
        setCommandStatus({ message: 'Running on-device LLM…', isError: false });

        const { schema, getSystemPrompt, applyResponse, isIncomplete, isUnknown } =
          optionsRef.current;
        const lastAgentResponse = lastSuccessfulAgentResponseRef.current;
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
          { role: 'user' as const, content: input },
        ];
        const reply = await currentLlm.generate(messages);
        console.log('[LLM] response:', reply);
        const formattedResponse = fixAndValidateStructuredOutput(reply, schema);

        if (!formattedResponse) {
          showStatus('Could not parse LLM response', true);
          return;
        }

        if (isIncomplete(formattedResponse)) {
          showStatus('Waiting for a complete command', false);
          return;
        }

        if (isUnknown(formattedResponse)) {
          showStatus('Unknown command', true);
          return;
        }

        const applied = await applyResponse(formattedResponse);
        if (!applied) {
          showStatus('Could not apply command', true);
          return;
        }

        if (applied.updateContext !== false) {
          lastSuccessfulAgentResponseRef.current = formattedResponse;
        }
        showStatus(`Applied: ${applied.label}`, false);
      } catch {
        showStatus('LLM inference failed', true);
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
    (committedSegment: string) => {
      const input = committedSegment.trim();
      if (!input) {
        return;
      }
      if (!llmRef.current.isReady) {
        return;
      }

      utteranceQueueRef.current.push(...splitSaveUtterance(input));

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

  const endSession = useCallback(() => {
    if (!sessionActiveRef.current) {
      return;
    }
    sessionActiveRef.current = false;
    setIsSessionActive(false);
    clearSafetyTimer();
    ExpoSpeechRecognitionModule.stop();
  }, [clearSafetyTimer]);

  const scheduleSafetyCap = useCallback(() => {
    clearSafetyTimer();
    safetyTimerRef.current = setTimeout(endSession, MAX_SESSION_DURATION_MS);
  }, [clearSafetyTimer, endSession]);

  useSpeechRecognitionEvent('result', (event) => {
    if (!sessionActiveRef.current) return;

    const transcript = event.results[0]?.transcript ?? '';

    if (event.isFinal) {
      committedTextRef.current += transcript + ' ';
      setHeardText(committedTextRef.current.trim());
      enqueueUtteranceRef.current(transcript);
    } else {
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
      clearUtteranceQueue();
      if (commandStatusTimerRef.current) {
        clearTimeout(commandStatusTimerRef.current);
      }
      if (sessionActiveRef.current) {
        sessionActiveRef.current = false;
        ExpoSpeechRecognitionModule.stop();
      }
    };
  }, [clearSafetyTimer, clearUtteranceQueue]);

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
