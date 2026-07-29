// The only context that handles a plaintext credential in the DOM.
//
// Runs on the chrome-extension:// origin, so the host page cannot read these
// inputs, listen to these events, or reach this document at all.
//
// Talks to the service worker exclusively over chrome.runtime.sendMessage.
// window.postMessage is never used, in either direction: a message event
// dispatched at the host window is visible to listeners in the page's own world,
// which would hand the plaintext straight to a hostile page.

const form = document.getElementById('form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const statusEl = document.getElementById('status');
const originEl = document.getElementById('origin');

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  if (kind) {
    statusEl.dataset.kind = kind;
  } else {
    delete statusEl.dataset.kind;
  }
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    // Service worker asleep mid-send, or the extension was reloaded/updated
    // while this frame stayed alive in an old page.
    return { ok: false, error: 'extension unavailable — reload the page' };
  }
}

async function prefill() {
  // Note the absence of an origin in this payload. The service worker derives it
  // from `sender`, so there is nothing here for a caller to lie about.
  const response = await send({ type: 'vault.load' });

  if (!response?.ok) {
    setStatus(response?.error ?? 'could not load', 'error');
    return;
  }

  originEl.textContent = response.origin;
  originEl.title = response.origin;

  if (response.credential) {
    usernameInput.value = response.credential.username ?? '';
    passwordInput.value = response.credential.password ?? '';
    setStatus('Loaded saved credentials.');
  } else {
    setStatus('Nothing saved for this site yet.');
    usernameInput.focus();
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Saving…');

  const response = await send({
    type: 'vault.save',
    username: usernameInput.value,
    password: passwordInput.value,
  });

  if (response?.ok) {
    setStatus('Saved.', 'ok');
  } else {
    setStatus(response?.error ?? 'save failed', 'error');
  }
});

prefill();
