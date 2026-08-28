import { File, Paths } from 'expo-file-system';

const LATENCY_FILE_NAME = 'command-latency.json';

export interface CommandLatencySample {
  recordedAt: string;
  utterance: string;
  appliedLabel: string;
  llmToApplyMs: number;
}

interface LatencyFile {
  samples: CommandLatencySample[];
}

export function buildCommandLatencySample(input: {
  utterance: string;
  appliedLabel: string;
  llmStartedAt: number;
  appliedAt: number;
}): CommandLatencySample | null {
  const llmToApplyMs = Math.round(input.appliedAt - input.llmStartedAt);
  if (!Number.isFinite(llmToApplyMs) || llmToApplyMs < 0) {
    return null;
  }
  return {
    recordedAt: new Date(input.appliedAt).toISOString(),
    utterance: input.utterance,
    appliedLabel: input.appliedLabel,
    llmToApplyMs,
  };
}

function latencyFile(): File {
  return new File(Paths.document, LATENCY_FILE_NAME);
}

async function readSamples(): Promise<CommandLatencySample[]> {
  const file = latencyFile();
  if (!file.exists) {
    return [];
  }
  const raw = await file.text();
  if (!raw.trim()) {
    return [];
  }
  const parsed = JSON.parse(raw) as LatencyFile;
  return Array.isArray(parsed.samples) ? parsed.samples : [];
}

function writeSamples(samples: CommandLatencySample[]): void {
  const file = latencyFile();
  if (!file.exists) {
    file.create();
  }
  file.write(JSON.stringify({ samples }, null, 2));
}

let persistQueue: Promise<void> = Promise.resolve();

export function recordCommandLatency(sample: CommandLatencySample): void {
  persistQueue = persistQueue
    .then(async () => {
      const samples = await readSamples();
      samples.push(sample);
      writeSamples(samples);
      console.log(
        `[latency] wrote ${samples.length} sample(s) to ${latencyFile().uri}`,
      );
    })
    .catch((error) => {
      console.warn('[latency] failed to persist sample', error);
    });
}
