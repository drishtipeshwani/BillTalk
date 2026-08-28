/** Canonical shop entity name: trim and collapse inner whitespace. */
export function normalizeEntityName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function entityNameKey(name: string): string {
  return normalizeEntityName(name).toLocaleLowerCase('en');
}

export function entityNamesMatch(left: string, right: string): boolean {
  return entityNameKey(left) === entityNameKey(right);
}

export function allowedEditDistance(length: number): number {
  if (length < 4) {
    return 0;
  }
  if (length < 6) {
    return 1;
  }
  return 2;
}

/** Levenshtein insert/delete/substitute distance. */
export function editDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  const prev = new Array<number>(right.length + 1);
  const curr = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) {
      prev[j] = curr[j];
    }
  }
  return prev[right.length];
}

/**
 * Return the catalog spelling that best matches `spoken`, or null.
 * Exact (case/space) wins. Otherwise the unique closest name within the
 * length-based edit-distance cap. Ties are rejected.
 */
export function fuzzyMatchEntityName(
  spoken: string,
  candidates: string[],
): string | null {
  const query = entityNameKey(spoken);
  if (!query) {
    return null;
  }

  for (const candidate of candidates) {
    if (entityNameKey(candidate) === query) {
      return candidate;
    }
  }

  let bestName: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestKey = '';
  let ties = 0;

  for (const candidate of candidates) {
    const key = entityNameKey(candidate);
    if (!key) {
      continue;
    }
    const dist = editDistance(query, key);
    const allowed = Math.min(
      allowedEditDistance(query.length),
      allowedEditDistance(key.length),
    );
    if (dist > allowed) {
      continue;
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestName = candidate;
      bestKey = key;
      ties = 1;
    } else if (dist === bestDist && key !== bestKey) {
      ties += 1;
    }
  }

  if (!bestName || ties > 1) {
    return null;
  }
  return bestName;
}
