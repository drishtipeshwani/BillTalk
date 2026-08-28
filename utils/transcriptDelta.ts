export const TRANSCRIPT_CHUNK_INTERVAL_MS = 300;

/**
 * Take the unsent suffix of the live STT transcript. `sentLength` is how
 * much of `liveTranscript` was already queued. Always advances the cursor
 * to the current live length so the next tick only sees new speech.
 */
export function consumeTranscriptDelta(
  liveTranscript: string,
  sentLength: number,
): { chunk: string; nextSentLength: number } {
  const nextSentLength = liveTranscript.length;
  const start = Number.isFinite(sentLength) ? Math.max(0, sentLength) : 0;
  if (start >= nextSentLength) {
    return { chunk: '', nextSentLength };
  }
  const remainder = liveTranscript.slice(start);
  return {
    chunk: remainder.trim() ? remainder : '',
    nextSentLength,
  };
}

/** Concatenate the next STT suffix as-is. Do not insert spaces. */
export function appendIncompleteUtterance(
  buffer: string,
  chunk: string,
): string {
  if (!chunk.trim()) {
    return buffer;
  }
  if (!buffer) {
    return chunk.trimStart();
  }
  return buffer + chunk;
}
