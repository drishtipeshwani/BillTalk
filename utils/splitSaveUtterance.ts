const SAVE_WORD = /\b(save|saved|saves)\b/gi;

/**
 * If a transcript contains save/saved/saves after other speech, split so
 * that word and everything after it is queued as its own LLM turn.
 */
export function splitSaveUtterance(utterance: string): string[] {
  if (!utterance) {
    return [];
  }

  let saveAt = -1;
  const matcher = new RegExp(SAVE_WORD.source, 'gi');
  let match = matcher.exec(utterance);
  while (match) {
    saveAt = match.index;
    match = matcher.exec(utterance);
  }

  if (saveAt <= 0) {
    return [utterance];
  }

  const prefix = utterance.slice(0, saveAt).trim();
  if (!prefix) {
    return [utterance];
  }

  return [prefix, utterance.slice(saveAt).trim()];
}
