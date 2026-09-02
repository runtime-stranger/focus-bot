<div align="center">

# FocusBot — Autonomous Deep Work Suite & Neural Frequency Synthesizer

live link: https://runtime-stranger.github.io/focus-bot/

**Chrome extension** that synthesizes binaural frequencies, Solfeggio tones and ambient noise in real time with the **Web Audio API** — bundled with a **Smart Pomodoro timer** and a privacy-first, **Bitcoin-only** licensing model.

![Web Audio API](https://img.shields.io/badge/Audio-Web%20Audio%20API-38bdf8)
![Zero-Telemetry](https://img.shields.io/badge/Telemetry-None-0f766e)
![License](https://img.shields.io/badge/License-Proprietary-F7931A)

**15-minute frictionless free trial · €12 / 1 Year (365 Days) · Bitcoin · No auto-renewal.**
Everything runs locally in your browser. Nothing is tracked, recorded, or uploaded.

</div>

---

## What is FocusBot?

FocusBot is a lightweight, **offline-first** Chrome extension for deep work. It synthesizes precise neural frequencies in real time inside your tab using the native **Web Audio API** — zero audio downloads, zero streaming, zero latency. It pairs a **Smart Pomodoro timer** with an **ambient noise mixer**, all inside one floating widget that stays in sync through the action popup.

- **Zero telemetry** — no analytics, no trackers, no crash reporting.
- **100% Offline-First** — all sound is generated on your device.
- **1-Year License (365 days)** — 15-minute free trial, then €12 for 365 days of PRO access, payable in Bitcoin via a non-recurring payment with no payment processor in the middle.

---

## Key Features

### Neural Frequencies — Delta to Gamma
Each binaural mode targets a specific cognitive state via exact left/right pairs:

| Mode | Left → Right (Hz) | Best For |
|---|---|---|
| **Delta** | 100 → 102 (Δ2) | Deep, restorative sleep |
| **Theta** | 180 → 186 (Δ6) | Creativity & meditation |
| **Alpha** | 200 → 210 (Δ10) | Relaxed focus & learning |
| **Beta** | 200 → 214 (Δ14) | Active concentration |
| **Gamma** | 200 → 240 (Δ40) | Peak cognition |

You can dial in any **custom binaural range** (0–1000 Hz) at any time.

### Full Solfeggio Spectrum — 174 Hz to 963 Hz
All ten Solfeggio tones delivered as equal-phase mono carriers, including the famous **432 Hz** and **528 Hz**:

**174 · 285 · 396 · 417 · 432 · 528 · 639 · 741 · 852 · 963 Hz**

### Ambient Noise Layers
**Pink · Brown · Rain · White** noise beds synthesize at runtime under your tones, each with an independent on/off toggle and its own volume stage — engineered to be clearly audible thanks to a unity ambient bus, pink makeup gain, and a dedicated brown deep-bass booster.

### Smart Pomodoro
25-minute focus / 5-minute break cycles that **auto-start the frequencies** with each focus phase and **auto-pause on breaks**. A soft synthesized **528 Hz crystal chime** marks every phase transition (2.5 s exponential tail — no audio file).

### Privacy-Focused Bitcoin License
- **15-minute frictionless trial** — no license, no key, no payment history; a live mm:ss countdown badge ("Trial: Xm Ys left") shows the remaining window.
- **€12 / 1-year (365 days)** — pay in Bitcoin directly to the developer's address; no payment processor or middleman.
- Paste your **TXID** (or a license key) to activate instantly via the Cloudflare Worker.

---

## Privacy, Permissions & Licensing

- **Zero telemetry** — FocusBot tracks nothing. Every preference, your trial window and your license state stay in your local browser (`chrome.storage.local`).
- **Minimal permissions** — only `storage` (plus the Web Audio API for synthesis). No browsing history, tabs, camera, microphone, or location access.
- **Bitcoin-only payments** — no credit card, bank, or billing address is ever requested, processed, or stored.

> *(Payment Note: To maximize user privacy and prevent unauthorized recurring card charges, FocusBot exclusively accepts Bitcoin for 1-year licenses. No credit card details, billing addresses, or personal financial data are ever requested, processed, or stored.)*

Read the full **[Privacy Policy →](privacy.html)**.

---

## Architecture & Technical Details

### Web Audio API Graph
FocusBot builds a **single `AudioContext`** exactly once, then manages playback purely through `suspend()` / `resume()` — eliminating context leaks and decoding churn. The graph is a structured pipeline:

- **Binaural engine** — two oscillators into a merger (L/R), gated behind a verified license.
- **Ambient buses** — Pink, Brown, Rain and White noise buffers generated at runtime.
- **Independent stages** — separate binaural/tone and ambient master gains, a deep-bass booster for Brown, and a final compressor to prevent clipping.
- **Clean teardown** — on `pagehide` the suspend timer is cleared and the context is suspended; nothing leaks in the background.

### License Hardening
- The `AudioContext` is **never constructed** without a verified license; flipping a flag cannot reconstruct the graph.
- Frequency coefficients are delivered as a **base64url + HMAC-SHA256 signed** `engine` token on every license verification; a tampered token falls back to a safe matrix.
- **Re-verification on every page load** and on tab foreground — if the server stops confirming the license, Pro is revoked immediately.
- A **trial watchdog** runs on a timer and on tab focus to live-lock the engine the instant the 15-minute trial window expires.

### Cloudflare Worker Endpoints

| Route | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `POST /api/verify-license` | License key → `{ valid, plan, expiresAt, engine }` |
| `POST /api/verify-tx` | BTC TXID → on-chain verification → auto activation |
| `GET /api/pricing` | Live EUR → satoshi conversion (cache + fallback) |
| `POST /api/admin/grant` | Issue licenses (admin token) |

---

## Development Setup

```bash
npm install      # no runtime dependencies
npm test         # test suite, zero external calls (Node.js >= 18)
npm run package  # rebuild the release ZIPs (flat bundle)
```

**Test the suite:**
```bash
npm test
```

**Build the extension bundles:**
```bash
npm run package
```
Writes `focus-bot-extension.zip` and `focus-bot-webstore-v1.3.1.zip` to the repo root.

### Install the extension locally (Chrome / Brave / Edge)

1. Download `focus-bot-extension.zip` from the **Releases** page and unzip it to a memorable folder.
2. Open `chrome://extensions` (Chrome / Brave) or `edge://extensions` (Edge).
3. Enable **Developer Mode** (top-right), click **Load unpacked** (top-left), and select the folder containing `manifest.json`.

---

## Repository Layout

```
client/
  manifest.json     Manifest (permissions, CSP, icons)
  focus-bot.js      Widget engine — audio graph, license, trial
  focus-bot.css     Widget & Buy Pro styles
  popup.html|js     Action popup (toolbar control)
  index.html        In-repo demo / local test page
  privacy.html      Bundled privacy page
index.html          Public landing page (GitHub Pages / Vercel / Netlify)
privacy.html        Public privacy policy page
worker/             Cloudflare Worker license API
tests/              Headless test suite (node)
scripts/            Package + icon generators
```

---

## Türkçe

<div align="center">

# FocusBot — Otonom Derin Çalışma Paketi ve Nöral Frekans Sentezleyici

**Chrome eklentisi** — **Web Audio API** ile binaural frekansları, Solfeggio tonlarını ve ambient gürültüyü gerçek zamanlı sentezler; **Akıllı Pomodoro** zamanlayıcısı ve gizlilik odaklı, **yalnızca Bitcoin** kabul eden lisanslama modeliyle birlikte gelir.

![Web Audio API](https://img.shields.io/badge/Audio-Web%20Audio%20API-38bdf8)
![Zero-Telemetry](https://img.shields.io/badge/Telemetry-None-0f766e)
![License](https://img.shields.io/badge/License-Proprietary-F7931A)

**15 dakikalık ücretsiz deneme · 12 € yıllık (365 gün) · Bitcoin · **
Her şey tarayıcınızda yerel olarak çalışır. Hiçbir şey izlenmez, kaydedilmez veya yüklenmez.

</div>

---

### FocusBot Nedir?

FocusBot, derin çalışma için tasarlanmış, hafif ve **çevrimdışı öncelikli** bir Chrome eklentisidir. Yerel **Web Audio API**'sini kullanarak tarayıcı sekmenizde nöral frekansları gerçek zamanlı üretir — sıfır ses indirme, sıfır akış, sıfır gecikme. **Akıllı Pomodoro** zamanlayıcısını bir **ambient gürültü karıştırıcısıyla** birleştirir; hepsi araç çubuğu popup'ıyla senkron çalışan tek bir yüzen pencerede toplanır.

- **Sıfır telemetri** — analitik, takipçi veya çökme raporlaması yok.
- **%100 Çevrimdışı Öncelikli** — tüm ses cihazınızda üretilir.
- **Tek seferlik lisans** — 15 dakikalık ücretsiz deneme, ardından 365 gün için 12 €, ortada ödeme işlemcisi olmadan Bitcoin ile ödenebilir.

### Temel Özellikler

#### Nöral Frekanslar — Delta'dan Gamma'ya
Her binaural mod, kesin sol/sağ frekans çiftleriyle belirli bir bilişsel durumu hedefler:

| Mod | Sol → Sağ (Hz) | En İyi Kullanım Alanı |
|---|---|---|
| **Delta** | 100 → 102 (Δ2) | Derin, onarıcı uyku |
| **Theta** | 180 → 186 (Δ6) | Yaratıcılık & meditasyon |
| **Alpha** | 200 → 210 (Δ10) | Rahat odaklanma & öğrenme |
| **Beta** | 200 → 214 (Δ14) | Aktif konsantrasyon |
| **Gamma** | 200 → 240 (Δ40) | Zirve biliş |

İstediğiniz zaman **özel binaural aralık** (0–1000 Hz) belirleyebilirsiniz.

#### Tam Solfeggio Spektrumu — 174 Hz'den 963 Hz'e
Ünlü **432 Hz** ve **528 Hz** dahil on Solfeggio tonu, eş fazlı mono taşıyıcılar olarak sunulur:

**174 · 285 · 396 · 417 · 432 · 528 · 639 · 741 · 852 · 963 Hz**

#### Ambient Gürültü Katmanları
**Pink · Brown · Rain · White** gürültü tabanları, tonlarınızın altına çalıştırma anında sentezlenir; her biri bağımsız aç/kapat anahtarına ve kendi ses seviyesi aşamasına sahiptir — birim ambient veri yolu, pink telafi kazancı ve özel bir brown derin bas güçlendirici sayesinde net duyulacak şekilde tasarlanmıştır.

#### Akıllı Pomodoro
25 dakika odaklanma / 5 dakika mola döngüleri; frekansları her odaklanma fazında **otomatik başlatır**, molalarda **otomatik duraklatır**. Her faz geçişinde yumuşak, sentezlenmiş bir **528 Hz kristal zil** çalar (2,5 s üstel kuyruk — ses dosyası yok).

#### Gizlilik Odaklı Bitcoin Lisansı
- **15 dakikalık sürtünmesiz deneme** — lisans, anahtar veya ödeme geçmişi gerekmez; kalan süreyi gösteren canlı mm:ss geri sayım rozeti ("Deneme: Xdk Ysn kaldı") vardır.
- **Tek seferlik 12 €, 365 gün** — doğrudan geliştiricinin adresine Bitcoin ile ödeyin; ödeme işlemcisi veya aracı yok.
- **TXID** (veya lisans anahtarınızı) yapıştırarak Cloudflare Worker üzerinden anında etkinleştirin.

### Gizlilik, İzinler ve Lisanslama

- **Sıfır telemetri** — FocusBot hiçbir şey izlemez. Tüm tercihleriniz, deneme süreniz ve lisans durumunuz yerel tarayıcınızda (`chrome.storage.local`) kalır.
- **Asgari izinler** — yalnızca `storage` (ve sentez için Web Audio API). Gezinme geçmişi, sekmeler, kamera, mikrofon veya konum erişimi yoktur.
- **Yalnızca Bitcoin ödemeleri** — kredi kartı, banka veya fatura adresi hiçbir zaman istenmez, işlenmez veya saklanmaz.

> *(Ödeme Notu: Kullanıcı gizliliğini en üst düzeye çıkarmak ve yetkisiz yinelenen kart tahsilatlarını önlemek için FocusBot, 1 yıllık (365 gün) lisanslar için yalnızca Bitcoin kabul eder. Kredi kartı bilgileri, fatura adresleri veya kişisel finansal veriler asla istenmez, işlenmez veya saklanmaz.)*

Tam **[Gizlilik Politikası'na](privacy.html)** göz atın.

### Mimari ve Teknik Detaylar

#### Web Audio API Grafiği
FocusBot tek bir **`AudioContext`** oluşturur ve oynatmayı tamamen `suspend()` / `resume()` üzerinden yönetir — bağlam sızıntıları ve çözme zorunluluğu ortadan kalkar. Grafik yapılandırılmış bir hattır:

- **Binaural motor** — doğrulanmış lisansın arkasına bağlanmış, birleştiriciye (L/R) giden iki osilatör.
- **Ambient veri yolları** — çalışma anında üretilen Pink, Brown, Rain ve White gürültü tamponları.
- **Bağımsız aşamalar** — ayrı binaural/ton ve ambient ana kazançları, Brown için derin bas güçlendirici ve kırpılmayı önleyen son bir kompresör.
- **Temiz kapatma** — `pagehide` olayında duraklatma zamanlayıcısı temizlenir ve bağlam duraklatılır; arka planda hiçbir şey sızmaz.

#### Lisans Sertleştirmesi
- Doğrulanmış lisans olmadan `AudioContext` **asla oluşturulmaz**; bir bayrağı çevirmek grafiği yeniden inşa edemez.
- Frekans katsayıları, her lisans doğrulamasında **base64url + HMAC-SHA256 imzalı** `engine` token'ı olarak iletilir; kurcalanmış bir token güvenli yedek matrise düşer.
- **Her sayfa yüklenişinde ve sekmeye dönüşte yeniden doğrulama** — sunucu lisansı onaylamazsa Pro anında iptal edilir.
- Deneme süresinin 15 dakikası dolar dolmaz motoru anında kilitlemek için bir **deneme bekçisi (watchdog)** zamanlayıcı ve sekme odağı üzerinde çalışır.

#### Cloudflare Worker Uç Noktaları

| Rota | Amaç |
|---|---|
| `GET /api/health` | Sağlık kontrolü |
| `POST /api/verify-license` | Lisans anahtarı → `{ valid, plan, expiresAt, engine }` |
| `POST /api/verify-tx` | BTC TXID → zincir üstü doğrulama → otomatik etkinleştirme |
| `GET /api/pricing` | Canlı EUR → satoshi dönüşümü (önbellek + yedek) |
| `POST /api/admin/grant` | Lisans üretimi (admin token) |

### Yerel Geliştirme Kurulumu

```bash
npm install      # çalışma zamanı bağımlılığı yok
npm test         # test paketi, sıfır dış çağrı (Node.js >= 18)
npm run package  # sürüm ZIP'lerini yeniden üretir (düz paket)
```

**Test paketini çalıştırın:**
```bash
npm test
```

**Eklenti paketlerini derleyin:**
```bash
npm run package
```
Repo köküne `focus-bot-extension.zip` ve `focus-bot-webstore-v1.3.1.zip` yazar.

### Eklentiyi yerel olarak yükleyin (Chrome / Brave / Edge)

1. **Releases** sayfasından `focus-bot-extension.zip` dosyasını indirin ve hatırlayacağınız bir klasöre çıkarın.
2. `chrome://extensions` (Chrome / Brave) veya `edge://extensions` (Edge) adresini açın.
3. **Geliştirici Modu**'nu (sağ üst) etkinleştirin, **Paketlenmemiş yükle** (sol üst) deyin ve `manifest.json` içeren klasörü seçin.

### Depo Yapısı

```
client/
  manifest.json     Manifest (izinler, CSP, ikonlar)
  focus-bot.js      Widget motoru — ses grafiği, lisans, deneme
  focus-bot.css     Widget ve Buy Pro stilleri
  popup.html|js     Araç çubuğu popup'ı
  index.html        Depo içi demo / yerel test sayfası
  privacy.html      Pakete dahil gizlilik sayfası
index.html          Genel tanıtım sayfası (GitHub Pages / Vercel / Netlify)
privacy.html        Genel gizlilik politikası sayfası
worker/             Cloudflare Worker lisans API'si
tests/              Headless test paketi (node)
scripts/            Paket + ikon üreticileri
```

---

## Legal Disclaimer

FocusBot is a sound-synthesis and productivity tool. It is **not** a medical device and is not intended to diagnose, treat, or cure any cognitive, neurological, or psychiatric condition. Blockchain payments are irreversible — verify all payment parameters before broadcasting.

### Yasal Uyarı

FocusBot bir ses sentezleme ve verimlilik aracıdır. **Tıbbi cihaz değildir**; herhangi bir bilişsel, nörolojik veya psikiyatrik durumu teşhis veya tedavi etme amacı taşımaz. Blokzincir ödemeleri geri alınamaz — yayınlamadan önce tüm ödeme parametrelerini kontrol edin.

---

## License

**Proprietary Commercial Software.** All rights reserved. Unauthorized copying, redistribution, or re-sale is prohibited. See the [Privacy Policy](privacy.html) for data-handling details.

### Lisans

**Ticari Özel Mülkiyet Lisansı.** Tüm hakları saklıdır. Kopyalama, yeniden dağıtım veya yeniden satış yasaktır. Veri işleme ayrıntıları için [Gizlilik Politikası'na](privacy.html) bakın.

---

*Last updated: September 2026 | FocusBot v1.3.1*
