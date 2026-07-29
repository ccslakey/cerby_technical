Deliverable. The extension (repo) plus a few short notes on your key design decisions, the
trust boundaries involved, and anything you'd change for production. This write-up is the part we
care most about.

Functional requirements
1. On any http/https page, a content script injects an "Open" button, fixed top-right,
overlaying page content.
2. Clicking Open surfaces an iframe hosting a small form: username, password,
submit.
3. Submitting persists the entered credentials.
4. After the host page reloads or navigates, clicking Open re-opens the form with the
previously-entered credentials pre-filled.

Before you architect, consider:
● Treat the host page as untrusted / potentially hostile — it is not your code.
● Minimize where the plaintext credential is exposed. Be ready to justify every
execution context it passes through or is readable from.
● Think about the scope of persistence: whose credentials, retrievable where.



1. content scripts
2. an iframe from them to be opened
3. local storage for entered credentials
4. obfuscate plain text possibly as byte arr
//STOP BEFORE THIS POINT TO ASSURE IT EXISTS IN WINDOWS API
5. for now, store credentials keyed by device id, avoid complicate 


/////// WRITEUP /////// 

**CLAUDE GENERATED**
** The defense is context isolation, not obfuscation.**

The form is not part of the page. It is a document on the `chrome-extension://` origin, embedded in an
iframe, and it speaks to the service worker over `chrome.runtime.sendMessage`. The consequence is that
the plaintext credential never enters the host page's process at all — not its DOM, not its JS heap,
and not even our own content script.
**END CLAUDE GENERATED**

My initial assumption was that we need to either have some sort of encyption between content script and service worker. But chrome extensions are able to pass this information without leaking. However, a clever user with device access could pull unencrypted data out of local storage. so obfuscating with a secret key would resolve this attack vector.

Spoofing is still a concern because users can be easily confused by a look alike. unfixable from inside a page but a toolbar popup or right click context menu are much more trustworthy in that they both look legitimate to users, and are outside of the potentially hostile webpage. Not what we were building today but a very possible design consideration in the field.

User auth skipped for brevity and to not stand up a server/db with protections also takes our current security from per browser profile to per authed user

Skipped safari/FF export for now but ideal for production code
