// The auth seam.
//
// Every credential record is namespaced under a subjectId. Today that subject is
// a per-install UUID, which means everyone sharing this browser profile shares
// one subject — a real gap, documented in NOTES.md rather than papered over.
//
// When real authentication lands, this module is the only thing that changes:
// getSubject() starts returning the id from the authenticated session. Storage
// keys are already subject-scoped, so no migration is required.

const SUBJECT_KEY = 'identity:subjectId';

// Serializes concurrent first-calls. Without this, two parallel messages
// arriving on a cold service worker could each mint a UUID and the second write
// would orphan the first subject's records.
let pending = null;

async function resolveSubject() {
  const bag = await chrome.storage.local.get(SUBJECT_KEY);
  const existing = bag[SUBJECT_KEY];
  if (typeof existing === 'string' && existing.length > 0) {
    return { id: existing };
  }
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [SUBJECT_KEY]: id });
  return { id };
}

export function getSubject() {
  if (pending === null) {
    pending = resolveSubject().catch((error) => {
      pending = null; // let the next caller retry rather than caching a failure
      throw error;
    });
  }
  return pending;
}
