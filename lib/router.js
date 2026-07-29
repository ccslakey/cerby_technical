// Message router and the security chokepoint.
//
// Kept out of bg/service-worker.js so the validation rules are unit-testable
// without a browser: the service worker is thin wiring around handleMessage().
//
// Two rules do the heavy lifting here:
//
//   1. Only the vault frame may talk to storage. Not the page (which has no
//      channel at all), and not our own content script either.
//   2. The origin a credential is filed under is derived from `sender`, which
//      the browser fills in, and NEVER from the message payload, which the
//      caller controls. See originFromSender().

import { getSubject } from './identity.js';
import { loadCredential, saveCredential } from './storage.js';

export const FRAME_RESOURCE = 'frame/form.html';
const FRAME_PATHNAME = `/${FRAME_RESOURCE}`;

// Distinguishes "caller is not allowed" from "we broke". Rejections are expected
// traffic in a hostile environment and are logged as warnings, not errors.
export class SenderRejected extends Error {
  constructor(message) {
    super(message);
    this.name = 'SenderRejected';
  }
}

// Matches on protocol + pathname rather than string-comparing against
// chrome.runtime.getURL(). Combined with the sender.id check that is just as
// tight, and it stays correct if the resource is ever served from a rotating
// dynamic URL (which changes the host portion, not the path).
export function assertFromVaultFrame(sender) {
  if (!sender || sender.id !== chrome.runtime.id) {
    throw new SenderRejected('sender is not this extension');
  }

  let url;
  try {
    url = new URL(sender.url ?? '');
  } catch {
    throw new SenderRejected('sender has no parseable url');
  }

  // A content script reports the *host page* URL here, so this rejects our own
  // content script along with everything else that isn't the frame document.
  if (url.protocol !== 'chrome-extension:' || url.pathname !== FRAME_PATHNAME) {
    throw new SenderRejected('sender is not the vault frame');
  }
}

// The authoritative origin for this request.
//
// sender.tab.url is populated by the browser (we hold host permissions for
// http/https) and cannot be forged by page or frame script. A hostile page that
// embeds the frame itself is therefore scoped to its own origin's record — which
// the legitimate button would have handed it anyway, so it gains nothing.
//
// Content scripts run with all_frames:false, so the tab URL is the top-level
// document the user is actually looking at.
export function originFromSender(sender) {
  const tabUrl = sender?.tab?.url;
  if (typeof tabUrl !== 'string' || tabUrl.length === 0) {
    throw new SenderRejected('no tab url; cannot establish an origin');
  }

  let url;
  try {
    url = new URL(tabUrl);
  } catch {
    throw new SenderRejected('unparseable tab url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SenderRejected(`unsupported scheme: ${url.protocol}`);
  }

  // url.origin keeps the scheme and the full host, so http/https and
  // example.com/sub.example.com are deliberately distinct vaults.
  return url.origin;
}

export async function handleMessage(message, sender) {
  assertFromVaultFrame(sender);
  const origin = originFromSender(sender);
  const { id: subjectId } = await getSubject();

  switch (message?.type) {
    case 'vault.load': {
      const record = await loadCredential(subjectId, origin);
      return {
        ok: true,
        origin,
        credential: record
          ? { username: record.username, password: record.password }
          : null,
      };
    }

    case 'vault.save': {
      const username = typeof message.username === 'string' ? message.username : '';
      const password = typeof message.password === 'string' ? message.password : '';
      if (username === '' && password === '') {
        return { ok: false, error: 'nothing to save' };
      }
      const record = await saveCredential(subjectId, origin, { username, password });
      return { ok: true, origin, updatedAt: record.updatedAt };
    }

    default:
      return { ok: false, error: 'unknown message type' };
  }
}
