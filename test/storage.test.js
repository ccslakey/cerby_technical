import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeStub, uninstallChromeStub } from './helpers/chrome-stub.js';
import { clearSubject, loadCredential, saveCredential } from '../lib/storage.js';

let store;

beforeEach(() => {
  store = installChromeStub().data;
});

afterEach(() => {
  uninstallChromeStub();
});

describe('credential round trip', () => {
  it('saves and loads a credential for a subject and origin', async () => {
    await saveCredential('subject-a', 'https://example.com', {
      username: 'ada',
      password: 'hunter2',
    });

    const record = await loadCredential('subject-a', 'https://example.com');
    expect(record).toMatchObject({ username: 'ada', password: 'hunter2' });
    expect(typeof record.updatedAt).toBe('number');
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadCredential('subject-a', 'https://example.com')).toBeNull();
  });

  it('overwrites the previous credential for the same origin', async () => {
    await saveCredential('subject-a', 'https://example.com', { username: 'ada', password: 'one' });
    await saveCredential('subject-a', 'https://example.com', { username: 'ada', password: 'two' });

    const record = await loadCredential('subject-a', 'https://example.com');
    expect(record.password).toBe('two');
  });
});

describe('isolation', () => {
  it('does not leak one subject’s credential to another subject', async () => {
    await saveCredential('subject-a', 'https://example.com', {
      username: 'ada',
      password: 'hunter2',
    });

    expect(await loadCredential('subject-b', 'https://example.com')).toBeNull();
  });

  it('keeps http and https as separate vaults', async () => {
    await saveCredential('subject-a', 'https://example.com', { username: 'ada', password: 'secure' });

    expect(await loadCredential('subject-a', 'http://example.com')).toBeNull();
  });

  it('keeps a subdomain separate from its parent domain', async () => {
    await saveCredential('subject-a', 'https://example.com', { username: 'ada', password: 'secure' });

    expect(await loadCredential('subject-a', 'https://login.example.com')).toBeNull();
  });

  it('keeps distinct ports separate', async () => {
    await saveCredential('subject-a', 'https://example.com:8443', { username: 'ada', password: 'p' });

    expect(await loadCredential('subject-a', 'https://example.com')).toBeNull();
  });
});

describe('clearSubject', () => {
  it('removes every record for that subject and nothing else', async () => {
    await saveCredential('subject-a', 'https://one.com', { username: 'a', password: '1' });
    await saveCredential('subject-a', 'https://two.com', { username: 'a', password: '2' });
    await saveCredential('subject-b', 'https://one.com', { username: 'b', password: '3' });
    store['identity:subjectId'] = 'subject-a';

    const removed = await clearSubject('subject-a');

    expect(removed).toBe(2);
    expect(await loadCredential('subject-a', 'https://one.com')).toBeNull();
    expect(await loadCredential('subject-a', 'https://two.com')).toBeNull();
    expect(await loadCredential('subject-b', 'https://one.com')).not.toBeNull();
    // Unrelated keys survive.
    expect(store['identity:subjectId']).toBe('subject-a');
  });

  it('reports zero when the subject has no records', async () => {
    expect(await clearSubject('nobody')).toBe(0);
  });
});

describe('key validation', () => {
  it('refuses a missing subject or origin', async () => {
    await expect(loadCredential('', 'https://example.com')).rejects.toThrow(/subjectId/);
    await expect(loadCredential('subject-a', '')).rejects.toThrow(/origin/);
  });

  it('refuses a subjectId containing a colon, which would make keys ambiguous', async () => {
    await expect(loadCredential('a:b', 'https://example.com')).rejects.toThrow(/":"/);
  });
});
