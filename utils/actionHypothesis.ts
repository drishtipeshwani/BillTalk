export function isActionItem(item: unknown): item is { action: string } {
  return (
    typeof item === 'object' &&
    item !== null &&
    'action' in item &&
    typeof (item as { action: unknown }).action === 'string'
  );
}

export function isActionList<T>(items: T[]): items is Array<T & { action: string }> {
  return items.length > 0 && items.every(isActionItem);
}

export function actionsAreEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function alreadyApplied<T>(action: T, applied: T[]): boolean {
  return applied.some((item) => actionsAreEqual(item, action));
}

function uniqueUnapplied<T>(actions: T[], applied: T[]): T[] {
  const unique: T[] = [];
  for (const action of actions) {
    if (alreadyApplied(action, applied)) {
      continue;
    }
    if (unique.some((item) => actionsAreEqual(item, action))) {
      continue;
    }
    unique.push(action);
  }
  return unique;
}

/**
 * Open action slot for a still-growing utterance.
 * Not a FIFO queue: the last uncommitted action is replaced when the LLM
 * revises the same type (SET_CUSTOMER "Ram" → "Ramesh"). A different type
 * (ADD_ITEM) finalizes that slot so it can be applied to the bill.
 * Repeated payloads (same customer + same item) are ignored.
 */
export function ingestPendingAction<T extends { action: string }>(
  pending: T | null,
  incoming: T[],
  applied: T[] = [],
): { toApply: T[]; pending: T | null } {
  if (incoming.length === 0) {
    return { toApply: [], pending };
  }

  const last = incoming[incoming.length - 1];
  if (pending && actionsAreEqual(last, pending)) {
    return { toApply: [], pending };
  }

  if (incoming.length === 1) {
    const next = incoming[0];
    if (pending && pending.action === next.action) {
      return { toApply: [], pending: next };
    }
    return {
      toApply: uniqueUnapplied(pending ? [pending] : [], applied),
      pending: next,
    };
  }

  const prefix = incoming.slice(0, -1);
  if (pending && pending.action === incoming[0].action) {
    return {
      toApply: uniqueUnapplied(prefix, applied),
      pending: last,
    };
  }
  return {
    toApply: uniqueUnapplied(
      pending ? [pending, ...prefix] : prefix,
      applied,
    ),
    pending: last,
  };
}

export function flushPendingAction<T>(
  pending: T | null,
  applied: T[] = [],
): T[] {
  if (!pending || alreadyApplied(pending, applied)) {
    return [];
  }
  return [pending];
}

