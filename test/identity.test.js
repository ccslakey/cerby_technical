import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub, uninstallChromeStub } from './helpers/chrome-stub.js';

// identity.js caches the resolved subject in module scope, which is the whole
// point of it — so every test needs a fresh module instance.
async function freshIdentity() {
  vi.resetModules();
  return import('../lib/identity.js');
}

let store;

beforeEach(() => {
  store = installChromeStub().data;
});

afterEach(() => {
  uninstallChromeStub();
});

describe('getSubject', () => {
  it('mints a subject id on first use and persists it', async () => {
    const { getSubject } = await freshIdentity();

    const { id } = await getSubject();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store['identity:subjectId']).toBe(id);
  });

  it('reuses an already persisted subject id', async () => {
    store['identity:subjectId'] = 'existing-subject';
    const { getSubject } = await freshIdentity();

    expect((await getSubject()).id).toBe('existing-subject');
  });

  it('is stable across repeated calls', async () => {
    const { getSubject } = await freshIdentity();

    const first = await getSubject();
    const second = await getSubject();

    expect(second.id).toBe(first.id);
  });

  it('mints exactly one id when called concurrently on a cold worker', async () => {
    const { getSubject } = await freshIdentity();
    const setSpy = vi.spyOn(chrome.storage.local, 'set');

    const results = await Promise.all([getSubject(), getSubject(), getSubject(), getSubject()]);

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    // Without the in-flight guard each caller would race to write its own UUID.
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure — the next caller retries', async () => {
    const { getSubject } = await freshIdentity();
    const getSpy = vi
      .spyOn(chrome.storage.local, 'get')
      .mockRejectedValueOnce(new Error('storage offline'));

    await expect(getSubject()).rejects.toThrow('storage offline');

    getSpy.mockRestore();
    await expect(getSubject()).resolves.toHaveProperty('id');
  });
});
