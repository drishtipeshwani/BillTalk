import type { z } from 'zod';

function coerceActionList(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) {
    return parsed.length > 0 ? parsed : null;
  }
  if (parsed !== null && typeof parsed === 'object') {
    return [parsed];
  }
  return null;
}

/**
 * Keep schema-valid actions and drop the rest so one hallucinated object
 * cannot discard a whole multi-action reply.
 */
export function parseValidActions<T>(
  parsed: unknown,
  itemSchema: z.ZodType<T>,
): T[] | null {
  const items = coerceActionList(parsed);
  if (!items) {
    return null;
  }

  const valid: T[] = [];
  for (const item of items) {
    const result = itemSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn('[LLM] skipped invalid action:', item);
    }
  }

  return valid.length > 0 ? valid : null;
}
