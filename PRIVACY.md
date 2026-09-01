# FocusBot — Privacy Policy

**Effective date:** September 1, 2026

Thank you for using FocusBot — the Autonomous Deep Work Suite. Your privacy is
fundamental to how this extension is built. This policy is short because we
have almost nothing to say about your data: **we do not collect it.**

## 1. No Personal Data Collection

**"Tek bir bayt bile kişisel veri toplanmaz, satılmaz veya üçüncü taraflarla
paylaşılmaz."** — Not a single byte of personal data is collected, sold, or
shared with third parties.

FocusBot is designed to operate entirely on your device. We do not have
servers that track what you do, which websites you visit, or how long you
spend on them.

## 2. Local-Only Storage

**"Tüm durumlar (ses frekansı tercihleri, Pomodoro ilerlemesi, lisans durumu)
yalnızca kullanıcının yerel tarayıcısında saklanır."** — All state (your saved
frequency preferences, Pomodoro progress, custom settings and license state)
is stored entirely in your local browser via `chrome.storage.local` (in the
extension) and `localStorage` (on the demo/standalone page). This includes the
start timestamp of your free trial window and your two independent volume
slider settings.

- This data never leaves your device. It cannot be accessed by us or by any
  third party.
- Removing the extension (or clearing browser data) permanently deletes all of
  it — including any remaining trial or license state.
- FocusBot does not collect usage logs, session timers or analytics of any
  kind.

## 3. Bitcoin Payments Are Processed Anonymously

**"Bitcoin ödemeleri yalnızca on-chain TXID doğrulaması için Cloudflare Worker
üzerinden anonim olarak işlenir."** — Bitcoin payments are processed
anonymously, solely for on-chain TXID verification, through our Cloudflare
Worker.

- To purchase a Pro license, you send Bitcoin to a public address and paste
  the public transaction hash (TXID) into the widget.
- The only data the Worker ever receives for this purpose is the **public
  TXID** (which is already visible on the public Bitcoin blockchain) and the
  domain you are verifying from — used solely to bind your license to the
  extension.
- No email, no name, no phone number, no bank or card details are ever asked
  for or stored.
- Bitcoin transactions are, by their nature, pseudonymous public ledger data.
  We do not link your identity to them.

## 4. Permissions We Use — And Why

FocusBot requests the **minimum** permissions required to function:

- **`storage`** — to persist your trial window, volume preferences and license
  state in `chrome.storage.local` (all stored strictly on your device).
- **`notifications`** — to alert you when a Pomodoro focus or break cycle
  completes. No notification content leaves your device.

We do **not** request access to your browsing history, tabs, bookmarks,
camera, microphone, location or any other personal resources.

## 5. Third-Party Services

- The **Cloudflare Worker** is used solely for license verification and the
  anonymous on-chain TXID check described above.
- **Live Bitcoin price feeds** (currently CoinGecko / mempool.space) are used
  only to display the current EUR→BTC conversion. They receive an anonymous
  public API request and no personal data.
- **QR code rendering** for the BTC address is generated via a public QR
  service; a request containing only the public Bitcoin address is sent.

None of these third parties receive, sell, or are able to associate personal
data with you.

## 6. No Tracking, No Logs

FocusBot includes **no analytics of any kind**, no ad trackers, no crash
reporting that leaves your device, and no fingerprinting. Nothing you do is
counted, stored or uploaded.

## 7. Contact

If you have any questions about this privacy policy or how your data is
handled, please open an issue on the project repository.

_This policy may be updated from time to time. Any changes will be reflected
here with a new effective date._
