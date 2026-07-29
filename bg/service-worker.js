// Thin wiring. All decisions live in lib/router.js so they can be tested.
//
// Note what is absent: no externally_connectable in the manifest, so no other
// extension and no website has a message path into this listener.

import { handleMessage, SenderRejected } from '../lib/router.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      if (error instanceof SenderRejected) {
        // Expected traffic in a hostile environment, not a malfunction.
        console.warn('[vault] rejected request:', error.message);
        sendResponse({ ok: false, error: 'rejected' });
        return;
      }
      console.error('[vault] handler failed:', error);
      // Deliberately vague: the caller learns nothing about internals.
      sendResponse({ ok: false, error: 'internal error' });
    });

  return true; // keep the channel open for the async response
});
