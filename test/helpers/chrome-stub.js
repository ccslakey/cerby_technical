// Minimal stand-in for the slice of the chrome.* surface this extension uses.
// Promise-based, matching MV3 behaviour.

export const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

export function installChromeStub({ id = EXTENSION_ID, seed = {} } = {}) {
  const data = { ...seed };

  const local = {
    async get(keys) {
      if (keys === null || keys === undefined) {
        return { ...data };
      }
      if (typeof keys === 'string') {
        return keys in data ? { [keys]: data[keys] } : {};
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const key of keys) {
          if (key in data) out[key] = data[key];
        }
        return out;
      }
      throw new TypeError(`chrome-stub: unsupported get() argument: ${typeof keys}`);
    },

    async set(items) {
      Object.assign(data, items);
    },

    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    },

    async clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
  };

  globalThis.chrome = {
    runtime: {
      id,
      getURL: (path) => `chrome-extension://${id}/${path}`,
    },
    storage: { local },
  };

  return { data };
}

export function uninstallChromeStub() {
  delete globalThis.chrome;
}

// Sender objects shaped the way Chrome fills them in.

export function frameSender({ id = EXTENSION_ID, tabUrl = 'https://example.com/login' } = {}) {
  return {
    id,
    url: `chrome-extension://${id}/frame/form.html`,
    frameId: 3,
    tab: { id: 42, url: tabUrl },
  };
}

// A content script reports the *host page* URL as sender.url — which is exactly
// how the router tells it apart from the frame document.
export function contentScriptSender({ id = EXTENSION_ID, tabUrl = 'https://example.com/login' } = {}) {
  return {
    id,
    url: tabUrl,
    frameId: 0,
    tab: { id: 42, url: tabUrl },
  };
}
