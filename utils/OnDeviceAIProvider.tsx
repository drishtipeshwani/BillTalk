import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { LLMModule } from 'react-native-executorch';
import { INVOICE_LLM_MODEL } from './invoiceModel';

type LlmMessages = Parameters<LLMModule['generate']>[0];
type LlmConfig = Parameters<LLMModule['configure']>[0];

interface OnDeviceLlm {
  isReady: boolean;
  downloadProgress: number;
  error: Error | null;
  configure: (config: LlmConfig) => void;
  generate: (
    messages: LlmMessages,
    onToken?: (token: string) => void,
  ) => Promise<string>;
  getGeneratedTokenCount: () => number;
  getPromptTokenCount: () => number;
  getTotalTokenCount: () => number;
}

interface OnDeviceAIContextValue {
  llm: OnDeviceLlm;
}

const OnDeviceAIContext = createContext<OnDeviceAIContextValue | null>(null);

export function OnDeviceAIProvider({ children }: { children: ReactNode }) {
  const moduleRef = useRef<LLMModule | null>(null);
  const activeTokenCallbackRef = useRef<((token: string) => void) | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    void LLMModule.fromModelName(
      INVOICE_LLM_MODEL,
      (progress) => {
        if (!cancelled) {
          setDownloadProgress(progress);
        }
      },
      (token) => activeTokenCallbackRef.current?.(token),
    )
      .then((module) => {
        if (cancelled) {
          module.delete();
          return;
        }
        moduleRef.current = module;
        setIsReady(true);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError
              : new Error('Failed to load on-device LLM'),
          );
        }
      });

    return () => {
      cancelled = true;
      const module = moduleRef.current;
      moduleRef.current = null;
      activeTokenCallbackRef.current = null;
      if (module) {
        try {
          module.delete();
        } catch {
          // The provider normally lives for the app lifetime. Avoid masking
          // unmount if native generation is still winding down.
        }
      }
    };
  }, []);

  const requireModule = useCallback(() => {
    const module = moduleRef.current;
    if (!module) {
      throw new Error('On-device LLM is not ready');
    }
    return module;
  }, []);

  const configure = useCallback(
    (config: LlmConfig) => requireModule().configure(config),
    [requireModule],
  );

  const generate = useCallback(
    async (messages: LlmMessages, onToken?: (token: string) => void) => {
      activeTokenCallbackRef.current = onToken ?? null;
      try {
        return await requireModule().generate(messages);
      } finally {
        activeTokenCallbackRef.current = null;
      }
    },
    [requireModule],
  );

  const getGeneratedTokenCount = useCallback(
    () => requireModule().getGeneratedTokenCount(),
    [requireModule],
  );
  const getPromptTokenCount = useCallback(
    () => requireModule().getPromptTokensCount(),
    [requireModule],
  );
  const getTotalTokenCount = useCallback(
    () => requireModule().getTotalTokensCount(),
    [requireModule],
  );

  const llm = useMemo<OnDeviceLlm>(
    () => ({
      isReady,
      downloadProgress,
      error,
      configure,
      generate,
      getGeneratedTokenCount,
      getPromptTokenCount,
      getTotalTokenCount,
    }),
    [
      isReady,
      downloadProgress,
      error,
      configure,
      generate,
      getGeneratedTokenCount,
      getPromptTokenCount,
      getTotalTokenCount,
    ],
  );

  return (
    <OnDeviceAIContext.Provider value={{ llm }}>
      {children}
    </OnDeviceAIContext.Provider>
  );
}

export function useOnDeviceAI(): OnDeviceAIContextValue {
  const value = useContext(OnDeviceAIContext);
  if (!value) {
    throw new Error('useOnDeviceAI must be used within OnDeviceAIProvider');
  }
  return value;
}
