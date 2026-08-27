# FocusBot — Autonomous Deep Work Suite & Neural Frequency Synthesizer

**Nöral frekanslar + Pomodoro akışı + günlük odaklanma analitiği.**
*Tek seferlik 12 € / 365 gün — abonelik yok, hepsi cihazınızda.*

> Chrome, Brave ve Edge için Manifest V3 eklentisi (tek seferlik yükleme). Tüm ses, **Web Audio API** ile tarayıcınızda gerçek zamanlı sentezlenir; hiçbir ses dosyası indirilmez veya akış yükü çekilmez. Çalışma istatistikleriniz başka bir sunucuya asla yüklenmez — yalnızca kendi tarayıcınızda tutulur.

---

## English

### What is FocusBot?

FocusBot is a fully-autonomous deep-work extension: a **binaural frequency synthesizer**, a **Smart Pomodoro timer** and a **local-only Deep Work Analytics** engine bundled into one floating widget. The audio is generated in real time inside your tab with the native Web Audio API — zero audio downloads, zero latency, works offline after first activation.

Each cognitive mode targets a brainwave band:

| Mode | Left → Right (Hz) | Best For |
|---|---|---|
| **Beta** | 200 → 214 | Active concentration, coding, task execution |
| **Alpha** | 200 → 210 | Deep learning, relaxed alertness, memory |
| **Theta** | 180 → 186 | Creativity, meditation, brainstorming |
| **Gamma** | 200 → 240 | Peak cognition, pattern recognition |

You can still set a **custom binaural range** (0–1000 Hz) at any time.

### The Full Deep-Work Loop

- **Neural Frequency Sync** — the binaural carrier keeps your brain anchored in the mode you pick.
- **Smart Pomodoro** — 25 min focus / 5 min break. The frequencies start automatically with the focus phase and auto-pause on break. At the end of each cycle you get a gentle in-app alert.
- **Deep Work Analytics** — today / this-week focus totals and completed sessions are tracked silently while you work, and persisted **locally** (chrome.storage.local in MV3, localStorage fallback).
- **Ambient Mixer** — optional Pink / Rain / White noise layer (allusion to BS129-style diffusion buffers, generated at runtime) sits under the binaural carrier for softer long sessions.
- **Dual-direction control** — the MV3 action popup (toolbar button) and the in-page draggable FAB stay in perfect sync through `chrome.runtime` messaging.

### Feature Matrix — why not just YouTube/Spotify?

| Capability | FocusBot | YouTube "focus mix" | Spotify "study playlist" |
|---|---|---|---|
| Audio rendering | Real-time synthesis | Streamed file | Streamed file |
| Precise frequency math | Exact L/R pairs | No | No |
| Autonomy | No playback service needed | Ads / tabs / autoplay | Subscription required |
| Focus-time analytics | Built-in, local-only | No | No |
| Pomodoro automation | Built-in (auto-play/auto-pause) | No | No |
| Cookie banners / trackers | None | Many | Many |
| Annual cost | **12 € one-time** | 0 € (but distraction) | ≈ 143 €/year |

### How to Install (3 steps, ~30 seconds)

1. **Download the extension**
   - Grab `focus-bot-extension.zip` from the **Releases** page of this repository
   - Unzip it to a folder you will remember (e.g. `Desktop/FocusBot`)

2. **Open the extensions page**
   - **Chrome / Brave:** type `chrome://extensions`
   - **Edge:** type `edge://extensions`

3. **Load it unpacked**
   - Enable **Developer Mode** (top-right)
   - Click **Load unpacked** (top-left)
   - Select the unzipped folder containing `manifest.json`
   - Done — a floating button and a **toolbar icon** appear, fully interlocked.

### Activation (12 € / Year, Bitcoin — no middleman)

1. Click the floating button and select **Buy Pro** (or use the toolbar popup).
2. Send the displayed satoshi amount (`12 EUR` pegged, converted live by the price worker) to the shown Bitcoin address — the address belongs **directly to the developer**, there is no payment processor.
3. Paste your **TXID** into the activation field and press **Verify & Activate** — the worker confirms the on-chain payment and issues a 365-day license instantly. License keys issued by the admin API work the same way.

### Security & License Hardening

- **Hard paywall on the client** — the `AudioContext` is never constructed without a verified license, so bypassing a flag cannot reconstruct the audio graph.
- **Signed engine token** — the frequency modulation matrix, phase angles and gain coefficients are *not* shipped as plain literals. The worker returns them inside a **base64url + HMAC-SHA256 signed** `engine` token with every license verification. A tampered or missing token silently falls back to a safe matrix instead of granting anything.
- **Re-verification on every page load** and on tab foreground — if the server stops confirming the license, Pro is revoked on the spot.
- **Zero telemetry** — analytics never leave the browser.
- Commercial distribution is licensed separately (see License).

### This-version highlights — v1.3.0

| Area | Change |
|---|---|
| Sandbox | Upgraded to **Manifest V3** (MV3) |
| Toolbar | New `popup.html` + `popup.js` — play/pause, mode, ambience, Pomodoro start/stop, live analytics (dual-direction bridge) |
| Productivity | Smart Pomodoro 25/5, Deep Work Analytics (today/week/sessions) |
| Audio | Ambient mixer (pink/rain/white), engine coefficient improvements |
| Hardening | Signed `engine` token from `/api/verify-license` + `/api/verify-tx` |
| Product | New brand line: *Autonomous Deep Work Suite & Neural Frequency Synthesizer* |

### Worker (Cloudflare Workers) endpoints

| Route | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `POST /api/verify-license` | License key → `{ valid, plan, expiresAt, engine }` |
| `POST /api/verify-tx` | BTC TXID → on-chain verification (mempool.space) → auto activation |
| `GET /api/pricing` | Live EUR→satoshi conversion (cache + fallback) |
| `POST /api/admin/grant` | Issue licenses (admin token) |

### Development

```bash
npm install      # no runtime deps
npm test         # 42 scenarios, zero external calls (Node.js >= 18)
npm run package  # rebuild focus-bot-extension.zip (MV3 flat bundle)
```

The extension bundle (`focus-bot-extension.zip`) ships 5 files: `manifest.json`, `focus-bot.js`, `focus-bot.css`, `popup.html`, `popup.js`.

### License

Proprietary Commercial Software. All rights reserved. Unauthorized copying, redistribution or re-sale is prohibited.

### Legal Disclaimer

FocusBot is a sound-synthesis and productivity tool. It is **not** a medical device and is not intended to diagnose, treat, or cure any cognitive, neurological, or psychiatric condition. Blockchain payments are irreversible — verify all payment parameters before broadcasting.

---

## Türkçe

### FocusBot Nedir?

FocusBot, tarayıcınızın **Web Audio API**'sini kullanarak binaural frekansları gerçek zamanlı sentezleyen, **Akıllı Pomodoro** ve **yerel (local-only) Derin Odak Analitiği** içeren kapsamlı bir derin çalışma eklentisidir. Ses dosyası indirmez, streaming yükü üretmez.

| Mod | Sol → Sağ (Hz) | En İyi Kullanım Alanı |
|---|---|---|
| **Beta** | 200 → 214 | Aktif odaklanma, kodlama, görev yürütme |
| **Alpha** | 200 → 210 | Derin öğrenme, sakin uyanıklık, hafıza |
| **Theta** | 180 → 186 | Yaratıcılık, meditasyon, beyin fırtınası |
| **Gamma** | 200 → 240 | Üst düzey bilişsel performans |

İstediğiniz zaman **özel binaural aralık** (0–1000 Hz) belirleyebilirsiniz.

### Tam Derin Çalışma Döngüsü

- **Nöral Frekans Sinkronizasyonu** — seçtiğiniz mod binaural taşıyıcı frekansı çalıştırır.
- **Akıllı Pomodoro** — 25 dk odaklanma / 5 dk mola. Frekanslar odaklanma fazında **otomatik başlar**, molada **otomatik durur**. Döngü sonunda sakin bir bildirim alırsınız.
- **Derin Çalışma Analitiği** — bugün / bu hafta odaklanma süreleri ve tamamlanan oturumlar sessizce kaydedilir; veriler **yalnızca cihazınızda** tutulur (MV3'te `chrome.storage.local`, düz entegrasyonda `localStorage`).
- **Ambient Mixer** — isteğe bağlı Pink / Rain / White gürültü katmanı (BS129-ilhamlı difüzyon tamponları, çalışma anında üretilir) binaural taşıyıcının altına karışır.
- **Çift yönlü kontrol** — MV3 araç çubuğu popup'ı ile sayfa içi sürüklenebilir FAB, `chrome.runtime` mesajlaşması üzerinden **senkron** çalışır.

### Özellik Matrisi — neden YouTube/Spotify değil?

| Yetenek | FocusBot | YouTube "odak karışımı" | Spotify "çalış listesi" |
|---|---|---|---|
| Ses üretimi | Gerçek zamanlı sentez | Dosya akışı | Dosya akışı |
| Frekans hassasiyeti | Tam L/R çiftleri | Yok | Yok |
| Bağımsızlık | Oynatma servisi gerekmez | Reklam/sekmeler/otomatik oynatma | Abonelik zorunlu |
| Odak analitiği | Dahili, yerel | Yok | Yok |
| Pomodoro otomasyonu | Dahili (otomatik başlat/durdur) | Yok | Yok |
| Çerez/takipçi | Yok | Çok | Çok |
| Yıllık maliyet | **Tek seferlik 12 €** | 0 € (ama dikkat dağınıklığı) | ≈ 143 €/yıl |

### Kurulum (3 adım, ~30 saniye)

1. **İndirin** — Bu deponun **Releases** sayfasından `focus-bot-extension.zip` dosyasını indirin ve hatırlayacağınız bir klasöre çıkarın (ör. `Masaüstü/FocusBot`).
2. **Eklenti sayfasını açın** — Chrome/Brave: `chrome://extensions`, Edge: `edge://extensions`.
3. **Yükleyin** — **Geliştirici Modu**'nu açın → **Paketlenmemiş yükle** → `manifest.json` içeren klasörü seçin. Hazır: yüzen buton ve **araç çubuğu ikonu** senkron şekilde çalışır.

### Aktivasyon (12 € / Yıl, Bitcoin — aracısız)

1. Yüzen butondan **Buy Pro** (veya araç çubuğu popup'ından) seçin.
2. Gösterilen Bitcoin adresine, fiyat işlemcisi tarafından canlı çevrilen satoshi miktarını gönderin — adres **doğrudan geliştiriciye** aittir, aracı yoktur.
3. **TXID**'inizi aktivasyon alanına yapıştırıp **Verify & Activate** deyin: worker zincir üstü ödemeyi doğrular ve 365 günlük lisansı anında verir. Admin API'nin ürettiği lisans anahtarları da aynı şekilde çalışır.

### Güvenlik ve Lisans Sertleştirmesi

- **Sert paywall (istemci)** — doğrulanmış lisans olmadan `AudioContext` **asla oluşturulmaz**; bir bayrağı çevirmek ses grafiğini yeniden inşa etmez.
- **İmzalı engine token** — frekans modülasyon matrisi, faz açıları ve kazanç katsayıları düz metin olarak paketlenmez. Worker, her lisans doğrulamasında bunları **base64url + HMAC-SHA256 imzalı** `engine` token'ı ile döndürür. Bozuk ya da eksik token hiçbir şey vermez; güvenli yedek matrise düşülür.
- **Her sayfa yüklenişinde ve sekmeye dönüşte yeniden doğrulama** — sunucu lisansı onaylamazsa Pro anında iptal edilir.
- **Sıfır telemetri** — analitiğiniz tarayıcıdan asla çıkmaz.
- Ticari dağıtım ayrı lisans kapsamındadır (bkz. Lisans).

### v1.3.0 sürüm öne çıkanları

| Alan | Değişiklik |
|---|---|
| Altyapı | **Manifest V3**'e geçiş (MV3) |
| Araç çubuğu | Yeni `popup.html` + `popup.js` — oynat/duraklat, mod, ambiyans, Pomodoro başlat/durdur, canlı analitik (çift yönlü köprü) |
| Verimlilik | Akıllı Pomodoro 25/5, Derin Çalışma Analitiği (bugün/hafta/oturum) |
| Ses | Ambient mixer (pink/rain/white), motor katsayı iyileştirmeleri |
| Sertleştirme | `/api/verify-license` + `/api/verify-tx` üzerinden imzalı `engine` token'ı |
| Ürün | Yeni marka hattı: *Autonomous Deep Work Suite & Neural Frequency Synthesizer* |

### Worker (Cloudflare Workers) uç noktaları

| Rota | Amaç |
|---|---|
| `GET /api/health` | Sağlık kontrolü |
| `POST /api/verify-license` | Lisans anahtarı → `{ valid, plan, expiresAt, engine }` |
| `POST /api/verify-tx` | BTC TXID → zincir üstü doğrulama (mempool.space) → otomatik aktivasyon |
| `GET /api/pricing` | Canlı EUR→satoshi dönüşümü (önbellek + yedek) |
| `POST /api/admin/grant` | Lisans üretimi (admin token) |

### Geliştirme

```bash
npm install      # çalışma zamanı bağımlılığı yok
npm test         # 42 senaryo, sıfır dış çağrı (Node.js >= 18)
npm run package  # focus-bot-extension.zip'i yeniden üretir (MV3 düz paket)
```

Eklenti paketi (`focus-bot-extension.zip`) 5 dosya içerir: `manifest.json`, `focus-bot.js`, `focus-bot.css`, `popup.html`, `popup.js`.

### Lisans

Ticari Özel Mülkiyet Lisansı. Tüm hakları saklıdır. Kopyalama, yeniden dağıtım veya yeniden satış yasaktır.

### Yasal Uyarı

FocusBot bir ses sentezleme ve verimlilik aracıdır. **Tıbbi cihaz değildir**; herhangi bir bilişsel, nörolojik veya psikiyatrik durumu teşhis veya tedavi etme amacı taşımaz. Blokzincir ödemeleri geri alınamaz — yayınlamadan önce tüm ödeme parametrelerini kontrol edin.