// Runs in the isolated world on every http/https page.
//
// This file deliberately never touches a credential. It cannot read the form
// (the frame is cross-origin), it receives no credential messages, and it holds
// no storage access. Its single privileged act is deciding to create the frame.
//
// That is the whole point: the content script shares a process and a DOM with a
// hostile page, so the design keeps the plaintext out of it entirely rather than
// trying to protect it once it is here.
//
// Content scripts cannot be ES modules in MV3, so this is a self-contained IIFE.

(() => {
  'use strict';

  // Top frame only. Without this we would paint a button inside every ad iframe.
  if (window.top !== window) return;

  // Skip non-HTML documents (standalone SVG, XML feeds) where injecting an
  // HTML host element is meaningless.
  if (!(document.documentElement instanceof HTMLElement)) return;

  // Guard against double injection. This global lives in the isolated world, so
  // the page can neither read it nor set it to suppress us.
  if (window.__credentialVaultInjected) return;
  window.__credentialVaultInjected = true;

  // Inline styles, every one !important: an inline !important declaration beats
  // an !important rule from a page stylesheet, so the page cannot restyle the
  // host through CSS alone. It can still mutate the attribute directly — hence
  // the observer below.
  const HOST_STYLE = [
    'position:fixed!important',
    'top:12px!important',
    'right:12px!important',
    'left:auto!important',
    'bottom:auto!important',
    'width:auto!important',
    'height:auto!important',
    'max-width:none!important',
    'max-height:none!important',
    'margin:0!important',
    'padding:0!important',
    'border:0!important',
    'background:transparent!important',
    'z-index:2147483647!important',
    'display:block!important',
    'visibility:visible!important',
    'opacity:1!important',
    'pointer-events:auto!important',
    'transform:none!important',
    'filter:none!important',
    'clip-path:none!important',
    'contain:none!important',
    'isolation:auto!important',
  ].join(';');

  const SHADOW_CSS = `
    :host { all: initial; }
    .wrap {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .toggle {
      padding: 6px 12px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      background: #2d5bd7;
      color: #fff;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
    }
    .toggle:hover { filter: brightness(1.08); }
    .toggle:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .panel {
      display: block;
      width: 268px;
      height: 232px;
      border: 1px solid rgba(0, 0, 0, 0.18);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.26);
      color-scheme: light dark;
    }
    .panel[hidden] { display: none; }
  `;

  // No id and no class on the host element, so the page has no stable selector
  // to target. It can still walk documentElement.children and find us — this
  // raises the cost of tampering, it does not prevent it. See NOTES.md.
  const host = document.createElement('div');
  host.setAttribute('style', HOST_STYLE);

  // Closed mode: the page cannot reach into this subtree. document.querySelector
  // does not traverse it, and host.shadowRoot returns null. The iframe element
  // itself is therefore not reachable from page script.
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.textContent = 'Open';
  toggle.setAttribute('aria-expanded', 'false');

  wrap.append(toggle);
  shadow.append(style, wrap);

  let frame = null;

  function ensureFrame() {
    if (frame) return frame;

    frame = document.createElement('iframe');
    // Cross-origin document. This is what keeps the credential out of the page.
    frame.src = chrome.runtime.getURL('frame/form.html');
    frame.className = 'panel';
    frame.setAttribute('title', 'Credential Vault');
    // Intentionally NOT sandboxed. The sandbox attribute would give this frame a
    // null origin and strip chrome.runtime, forcing the credential back out
    // through postMessage — the exact leak this architecture exists to avoid.
    wrap.append(frame);
    return frame;
  }

  function setOpen(open) {
    // The frame is created on first open, not at page load: no reason to spin up
    // an extension document and read storage on every page the user visits.
    if (open) ensureFrame();
    if (frame) frame.hidden = !open;
    toggle.textContent = open ? 'Close' : 'Open';
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => {
    setOpen(frame === null || frame.hidden);
  });

  // Re-assert placement if the page removes the host or rewrites its style
  // attribute. Both branches are no-ops when nothing changed, so the observers
  // do not retrigger themselves into a loop.
  function assertPlacement() {
    if (host.parentNode !== document.documentElement) {
      document.documentElement.append(host);
    }
    if (host.getAttribute('style') !== HOST_STYLE) {
      host.setAttribute('style', HOST_STYLE);
    }
  }

  document.documentElement.append(host);
  setOpen(false);

  // childList on documentElement catches removal; attributes on the host catches
  // restyling. Neither uses subtree, so this stays cheap on large pages.
  new MutationObserver(assertPlacement).observe(document.documentElement, {
    childList: true,
  });
  new MutationObserver(assertPlacement).observe(host, {
    attributes: true,
    attributeFilter: ['style'],
  });
})();
