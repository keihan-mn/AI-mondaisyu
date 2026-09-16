export const DRAFT_PREFIX = "ai-mondaisyu:draft:";

export function draftStorageKey(path) {
  return `${DRAFT_PREFIX}${path}`;
}

export function createDraftEnvelope(signature, answers, savedAt = new Date()) {
  return {
    version: 1,
    signature,
    answers: { ...answers },
    savedAt: savedAt instanceof Date ? savedAt.toISOString() : new Date(savedAt).toISOString(),
  };
}

export function parseDraft(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== 1 || typeof parsed.signature !== "string" || !parsed.answers || typeof parsed.answers !== "object" || Array.isArray(parsed.answers)) return null;
    const answers = Object.fromEntries(Object.entries(parsed.answers).filter(([, answer]) => typeof answer === "string"));
    return { ...parsed, answers };
  } catch {
    return null;
  }
}

export function reconcileDraft(draft, currentSignature) {
  if (!draft) return { answers: {}, sourceChanged: false };
  return {
    answers: { ...draft.answers },
    sourceChanged: draft.signature !== currentSignature,
  };
}
