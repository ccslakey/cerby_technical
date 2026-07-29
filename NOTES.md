# Credential Vault — design notes

An MV3 extension that injects an **Open** button on any http/https page, opens a small
username/password form, persists what is submitted, and re-fills it when you return to that origin.

Load it with `chrome://extensions` → Developer mode → **Load unpacked** → this directory. There is no
build step.

---

## The one idea

**The defense is context isolation, not obfuscation.**

The form is not part of the page. It is a document on the `chrome-extension://` origin, embedded in an
iframe, and it speaks to the service worker over `chrome.runtime.sendMessage`. The consequence is that
the plaintext credential never enters the host page's process at all — not its DOM, not its JS heap,
and not even our own content script.

Everything below follows from that, including the decision *not* to add an obfuscation layer.

---

## Trust boundaries

Four execution contexts. The boundary that matters runs between 1/2 and 3/4.

| # | Context | Trust | Sees plaintext? |
|---|---|---|---|
| 1 | Host page (page world) | Hostile — not our code | **No** |
| 2 | `content/inject.js` (isolated world) | Ours, but shares the page's DOM and process | **No — by design** |
| 3 | `frame/form.{html,js}` (`chrome-extension://` origin) | Ours | Yes — the only UI permitted to |
| 4 | `bg/service-worker.js` + `chrome.storage.local` | Ours | Yes — sole owner of storage |

### Every context the plaintext passes through, and why it has to

The brief asks us to justify each one. There are two, and one channel.

1. **The frame (#3).** Keystrokes land in an `<input>` here. Unavoidable — something has to render a
   form — and this is the only context in the stack the page cannot read. Cross-origin means no
   `contentDocument`, no reading `input.value`, no attaching listeners, no reaching the document at
   all. The iframe *element* is additionally inside a closed shadow root, so page script cannot even
   find it with `document.querySelectorAll('iframe')`.

2. **The service worker (#4).** The credential travels #3 → #4 over `chrome.runtime.sendMessage`, an
   extension-internal IPC channel the page can neither observe nor inject into. Unavoidable —
   storage needs a single owner, and centralising it means there is exactly one file to audit.

3. **At rest**, in `chrome.storage.local`: per-profile, per-extension, unreachable from any web
   origin. Recall runs the same path in reverse.

Total exposure: two contexts, one channel, zero page-readable surfaces. The content script — the
component actually sitting in the blast radius — is excluded entirely.

---

## Design decisions

### Why there is no obfuscation layer (and why the requirement changed shape)

The original framing was "host pages are possibly hostile, so obfuscate the plaintext credentials
when filling them." Obfuscation only buys something if the plaintext passes somewhere the attacker
can read it. In this architecture it doesn't. XOR-ing or base64-ing the value on its way into an
input the page already cannot read protects nothing, and it costs something real: it makes the design
*look* hardened, which is worse than being visibly unhardened. Anyone auditing it has to spend effort
discovering that the layer is decorative.

The same reasoning rules out encrypting `chrome.storage.local` in this build. Without a secret the
user supplies, the key has to ship next to the ciphertext, which is obfuscation with extra steps. See
[Shared machines](#shared-machines) for what would actually fix this.

### Two traps that look like hardening

**`window.postMessage` is disqualified.** It is the obvious way to move data between a frame and a
content script, and it would be a direct credential leak. A `message` event dispatched at the host
window is delivered to listeners in the page's world as well as the isolated world — the page just
adds `addEventListener('message', …)` and reads the plaintext. The frame therefore talks *only* to
the service worker, never to the content script, in either direction.

**The frame is deliberately not `sandbox`ed.** Adding `sandbox` is the reflexive hardening move on an
iframe, and here it is precisely wrong: a sandboxed frame gets a null origin and loses access to
`chrome.runtime`, which would force the credential back out through `postMessage`. The security comes
from the frame having a *real, distinct* origin, not from restricting it.

### The origin is derived from `sender`, never from the message

`lib/router.js` computes the origin from `sender.tab.url`, which the browser fills in and no script
can forge. The `vault.load` message carries no origin field at all, so there is nothing for a caller
to lie about.

This closes the obvious attack: a hostile page embeds `frame/form.html` itself and claims to be
`https://yourbank.com`. It gets scoped to its own origin's record — which the legitimate button would
have handed it anyway, so it gains nothing.

### Even our own content script cannot ask for a credential

Before touching storage, the router checks that `sender.url` is the frame document on the
`chrome-extension:` origin at path `/frame/form.html`. A content script reports the *host page* URL in
`sender.url`, so this check rejects our own content script alongside everything else. The component
with the largest attack surface has no read path to the vault, which means compromising it does not
compromise stored credentials.

The check matches on protocol plus pathname rather than string-comparing against
`chrome.runtime.getURL()`, so it stays correct if the resource is ever moved behind a rotating URL.
`sender.id === chrome.runtime.id` is verified too, and `externally_connectable` is absent from the
manifest, so no other extension and no website has a message path into the listener at all.

### Keyed per origin

`vault:<subjectId>:<origin>`, where origin includes scheme, full host, and port. `http://example.com`,
`https://example.com`, `https://login.example.com`, and `https://example.com:8443` are four separate
vaults. This matches the same-origin policy the rest of the design leans on: two documents that
cannot read each other's cookies should not share a credential either.

### Frame tampering: mitigation, not a boundary

The host element has no `id` and no `class`, so there is no stable selector to target. Its geometry is
set as inline `!important` declarations, which beat `!important` rules from a page stylesheet, so CSS
alone cannot move or hide it. Two `MutationObserver`s re-assert placement if the page removes the host
or rewrites its `style` attribute.

This raises the cost of tampering. **It is not a security boundary**, and it is listed under
limitations below, not under wins.

### Requirement 6, honestly: an identity seam rather than a lock

"Credentials should not be shared with other users of the extension" has two readings, and they need
different answers.

*Across installs*: satisfied by construction. `chrome.storage.local` is per-profile and never synced.
Using `chrome.storage.sync` would have crossed machines, so we don't.

*Across humans on one profile*: **not solved**, deliberately. Every record is namespaced under a
`subjectId` from `lib/identity.js`, which today returns a per-install UUID. Because every storage path
is already subject-scoped, swapping that module for one returning an authenticated session's id needs
no schema migration — the seam is built, the authority behind it isn't. What we did *not* do is ship a
local passphrase vault to make this look solved; a second unrelated credential to manage, largely
replaced once real auth lands.

### What this extension cannot do: autofill the page's login form

It stores and recalls credentials. It does not type them into the host page's own form. That would
mean writing plaintext into page-readable DOM, which contradicts the entire premise above.

This is a genuine product fork, not an oversight. A real password manager accepts that exposure and
manages it — narrowly scoped injection, per-origin user consent, careful handling of the moment of
fill. If autofill is a requirement, the trust model has to be redesigned rather than extended.

### On `use_dynamic_url`, and whether it stops clickjacking

`use_dynamic_url: true` rotates a web-accessible resource's URL so a page cannot hardcode
`chrome-extension://<id>/frame/form.html`. It is not enabled here. The reasoning is worth recording,
because it looks like a free win:

- It blocks exactly one attack: **the page embedding our real frame itself.**
- It does nothing about the frame *we* inject — which is the exposed one, because by design it lives
  in the page's DOM. The page owns that geometry and can lay bait over our frame with
  `pointer-events: none`, so the user sees one thing and the click lands on our submit button. No
  stable URL is involved.
- Its nominal purpose is anti-fingerprinting, and we have already given that up: we inject a visible
  button into the page's light DOM, so the page knows the extension is installed.
- It interacts with the `sender.url` frame check above, which is load-bearing. Trading a load-bearing
  control for a partial one is a bad trade.

Two observations that de-rank clickjacking here anyway. First, **the frame has almost no action
surface worth hijacking**: one button, which saves what the user already typed. No reveal-password
toggle, no send, no delete. Keeping the controls that boring is intentional. Second, **the attack that
actually harvests credentials is spoofing, not clickjacking** — the page draws its own convincing
lookalike form and reads the keystrokes directly, never touching our frame, and no URL scheme helps.

If page-embedding were ranked higher, the right fix is not URL secrecy but a **nonce**: the content
script mints one, registers it with the service worker, and passes it to the frame in the URL
fragment — unreadable by the page, since the iframe element sits inside a closed shadow root — and the
service worker refuses requests without a live nonce. That rejects page-created frames on their
merits. Not built, because its impact is already matched by the fake-form attack, which is unfixable
from inside the page.

---

## Limitations

Stated plainly, because a threat model that only lists wins isn't one.

- **The page can clickjack or overlay our button**, and it can draw a convincing fake form to harvest
  keystrokes directly. **No amount of in-page code fixes this.** The only trustworthy surface is
  browser chrome the page cannot reach — the action popup or the side panel. Any in-page credential UI
  is advisory.
- <a id="shared-machines"></a>**Everyone sharing a browser profile shares one `subjectId`** and sees
  the same credentials. Real authentication closes this; the seam is ready.
- **Credentials are plaintext at rest on disk.** Anyone with filesystem access to the profile
  directory can read them. Meaningful encryption needs a key that isn't stored beside the data, which
  means a user secret or a session-derived key.
- **Another extension with debugger permissions, or devtools attached to the service worker, can read
  the vault.** Extension isolation does not defend against local privilege.
- **The host element is visible in the light DOM**, so the extension is trivially fingerprintable.
- One credential per origin — no multi-account support.
- `host_permissions` covers all http/https. Needed so `sender.tab.url` is populated for the origin
  derivation, but it is broad, and a production version should narrow it or move to
  `activeTab`-style access.

---

## Verification status

Partial. Be precise about what has and has not been checked:

- **Syntax only, verified**: all JS parses (`node --check`) and both JSON files are valid.
- **Unit tests, reportedly passing but not by me**: `test/storage.test.js` and
  `test/identity.test.js` exist, with a `chrome.*` stub in `test/helpers/`. Vitest's cache
  (`node_modules/.vite/vitest/…/results.json`) records both suites as having run without failures,
  but that run happened outside this work and I have not reproduced it. Re-run `npm test` before
  relying on it.
- **The router is untested.** `test/router.test.js` is **not written** — including the test that
  matters most, asserting a payload-supplied `origin` is ignored in favour of `sender.tab.url`. That
  test is the executable form of the central security claim, and its absence is the largest gap here.
- **Never loaded in a browser.** No behaviour in the extension itself has been observed.

Treat every behavioural claim above as designed-and-reasoned, not observed. What still needs doing:

1. `npm test`, and confirm the result rather than trusting the cache.
2. Write the router tests: reject a content-script sender, reject a foreign `sender.id`, ignore a
   payload `origin`, reject non-http/https tab URLs.
3. Load unpacked and confirm the button renders top-right, the form saves, and it re-fills after a
   reload and after navigating away and back; confirm a different origin shows an empty form.
4. From the host page's own console, confirm the isolation claims: `document.querySelectorAll('iframe')`
   does not reach our frame, `contentDocument` is `null`, and no credential traffic ever fires a
   `message` event. Delete the host element and mutate its `style` to confirm the observers re-assert.

---

## What I would change for production

1. **Real authentication at the identity seam.** The single highest-value change; it is what actually
   makes requirement 6 true rather than structurally ready.
2. **Move the primary UI into the side panel or action popup** and demote the in-page button to a
   launcher. This is the only fix for clickjacking and spoofing, because it moves credential entry
   onto a surface the page cannot draw over or imitate.
3. **Encryption at rest keyed to the authenticated session**, with the key held in service-worker
   memory and an idle re-lock. Worth doing once there is a session to key it to — not before.
4. **Narrow `host_permissions`**, or derive the origin via `chrome.webNavigation.getFrame` so broad
   host access isn't needed for the origin derivation.
5. **Per-origin consent, credential deletion, and an audit trail** — a vault with no delete path and
   no record of reads isn't shippable.
6. **Multi-account per origin**, with an explicit chooser.
7. **The nonce handshake** from the `use_dynamic_url` section, if page-embedded frames rank higher
   after a real threat-modelling pass.
8. **Firefox and Safari ports** — both diverge on MV3 background scripts and on
   `web_accessible_resources`.
