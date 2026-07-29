// Credential persistence. Imported ONLY by the service worker — no other context
// touches chrome.storage.local, so there is exactly one place to audit.
//
// Key layout:  vault:<subjectId>:<origin>
//
// subjectId is a UUID (no colons), so `vault:<subjectId>:` is an unambiguous
// prefix for "everything belonging to this subject" even though origins contain
// colons themselves.

const VAULT_PREFIX = 'vault:';

function subjectPrefix(subjectId) {
  if (typeof subjectId !== 'string' || subjectId.length === 0) {
    throw new TypeError('subjectId is required');
  }
  if (subjectId.includes(':')) {
    throw new TypeError('subjectId must not contain ":"');
  }
  return `${VAULT_PREFIX}${subjectId}:`;
}

function vaultKey(subjectId, origin) {
  if (typeof origin !== 'string' || origin.length === 0) {
    throw new TypeError('origin is required');
  }
  return `${subjectPrefix(subjectId)}${origin}`;
}

export async function saveCredential(subjectId, origin, { username, password }) {
  const record = {
    username: typeof username === 'string' ? username : '',
    password: typeof password === 'string' ? password : '',
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [vaultKey(subjectId, origin)]: record });
  return record;
}

export async function loadCredential(subjectId, origin) {
  const key = vaultKey(subjectId, origin);
  const bag = await chrome.storage.local.get(key);
  return bag[key] ?? null;
}

// Used by the "forget everything for this subject" path. Also the migration hook
// for when a real authenticated subject replaces the local one.
export async function clearSubject(subjectId) {
  const prefix = subjectPrefix(subjectId);
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(prefix));
  if (keys.length > 0) {
    await chrome.storage.local.remove(keys);
  }
  return keys.length;
}

export const __testing = { vaultKey, subjectPrefix };
