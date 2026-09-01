# FocusBot — Autonomous Deep Work Suite & Neural Frequency Synthesizer

**Nöral frekanslar + Pomodoro akışı + ambient karıştırıcısı.**
*3 gün ücretsiz deneme, ardından tek seferlik 12 € / 365 gün — abonelik yok, hepsi cihazınızda.*

> Chrome, Brave ve Edge için Manifest V3 eklentisi (tek seferlik yükleme). Tüm ses, **Web Audio API** ile tarayıcınızda gerçek zamanlı sentezlenir; hiçbir ses dosyası indirilmez veya akış yükü çekilmez. Çalışma istatistikleriniz başka bir sunucuya asla yüklenmez — yalnızca kendi tarayıcınızda tutulur.

---

## English

### What is FocusBot?

FocusBot is a fully-autonomous deep-work extension: a **binaural frequency synthesizer**, a **Smart Pomodoro timer** and an **ambient mixer** bundled into one floating widget. The audio is generated in real time inside your tab with the native Web Audio API — zero audio downloads, zero latency, works offline after first activation.

Each cognitive mode targets a brainwave band:

| Mode | Left → Right (Hz) | Best For |
|---|---|---|
| **Beta** | 200 → 214 | Active concentration, coding, task execution |
| **Alpha** | 200 → 210 | Deep learning, relaxed alertness, memory |
| **Theta** | 180 → 186 | Creativity, meditation, brainstorming |
| **Gamma** | 200 → 240 | Peak cognition, pattern recognition |

You can still set a **custom binaural range** (0–1000 Hz) at any time.

Deeper sleep and meditative modes are built in too:

| Mode | Frequency (Hz) | Best For |
|---|---|---|
| **Delta** | 100 → 102 (Δ2) | Deep, restorative sleep |
| **Solfeggio 432** | 432 (mono, equal-phase) | Calm, grounding, "natural" tuning |
| **Solfeggio 528** | 528 (mono, equal-phase) | Healing / "love frequency", focus |

### The Full Deep-Work Loop

- **Neural Frequency Sync** — the binaural carrier keeps your brain anchored in the mode you pick.
- **Smart Pomodoro** — 25 min focus / 5 min break. The frequencies start automatically with the focus phase and auto-pause on break. At the end of each cycle you get a gentle in-app alert.
- **Ambient Mixer** — optional Pink / **Brown** / Rain / White noise layer (allusion to BS129-style diffusion buffers, generated at runtime) sits under the binaural carrier for softer, longer sessions. Each layer gets its own on/off toggle.
- **Independent volume stages** — "Binaural / Tone" and the "Ambient Mixer" bus each have their own slider; you can fade tone against ambience independently.
- **Synthesized Pomodoro chime** — every focus↔break transition rings a soft D5 gong generated live (no audio file).
- **Dual-direction control** — the MV3 action popup (toolbar button) and the in-page draggable FAB stay in perfect sync through `chrome.runtime` messaging.

### Feature Matrix — why not just YouTube/Spotify?

| Capability | FocusBot | YouTube "focus mix" | Spotify "study playlist" |
|---|---|---|---|
| Audio rendering | Real-time synthesis | Streamed file | Streamed file |
| Precise frequency math | Exact L/R pairs | No | No |
| Autonomy | No playback service needed | Ads / tabs / autoplay | Subscription required |
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

### Activation & Trial (12 € / Year, Bitcoin — no middleman)

1. FocusBot ships with a **3-day frictionless trial** — no license, no key, no payment history required. Click Play and listen for 72 hours. A live countdown badge in the widget footer shows the remaining window.
2. When the trial ends the widget locks automatically (audio pauses on the spot) and opens the upsell.
3. To keep listening, click **Buy Pro** and send the displayed satoshi amount (`12 EUR` pegged, converted live by the price worker) to the shown Bitcoin address — the address belongs **directly to the developer**, there is no payment processor.
4. Paste your **TXID** into the activation field and press **Verify & Activate** — the worker confirms the on-chain payment and issues a 365-day license instantly. License keys issued by the admin API work the same way.

### Security & License Hardening

- **Hard paywall on the client** — the `AudioContext` is never constructed without a verified license, so bypassing a flag cannot reconstruct the audio graph.
- **Signed engine token** — the frequency modulation matrix, phase angles and gain coefficients are *not* shipped as plain literals. The worker returns them inside a **base64url + HMAC-SHA256 signed** `engine` token with every license verification. A tampered or missing token silently falls back to a safe matrix instead of granting anything.
- **Re-verification on every page load** and on tab foreground — if the server stops confirming the license, Pro is revoked on the spot.
- **Zero telemetry** — FocusBot tracks nothing; every preference stays in your browser.
- Commercial distribution is licensed separately (see License).

### This-version highlights — v1.4.0

| Area | Change |
|---|---|
| Trial | **3-day frictionless trial** (72h, live expiry watchdog, persists across reloads) |
| Modes | New **Delta** (100/102) + **Solfeggio 432 Hz** & **528 Hz** (equal-phase mono) |
| Audio | **Brown** noise layer added to the ambient mixer (pink/brown/rain/white) |
| Mixer | Independent **Binaural/Tone** + **Ambient** volume sliders |
| Chime | Synthesized **D5 gong** on every Pomodoro phase change (no audio file) |
| Sandbox | Manifest V3 (MV3), version bump to 1.4.0 |
| Hardening | Signed `engine` token from `/api/verify-license` + `/api/verify-tx` |

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
npm test         # 67 scenarios, zero external calls (Node.js >= 18)
npm run package  # rebuild focus-bot-extension.zip (MV3 flat bundle)
```

The extension bundle (`focus-bot-extension.zip`) ships `manifest.json`, `focus-bot.js`, `focus-bot.css`, `popup.html`, `popup.js`, `privacy.html` and the four icon sizes.

### License

Proprietary Commercial Software. All rights reserved. Unauthorized copying, redistribution or re-sale is prohibited.

### Legal Disclaimer

FocusBot is a sound-synthesis and productivity tool. It is **not** a medical device and is not intended to diagnose, treat, or cure any cognitive, neurological, or psychiatric condition. Blockchain payments are irreversible — verify all payment parameters before broadcasting.

---

## Türkçe

### FocusBot Nedir?

FocusBot, tarayıcınızın **Web Audio API**'sini kullanarak binaural frekansları gerçek zamanlı sentezleyen, **Akıllı Pomodoro** ve **ambient karıştırıcısı** içeren kapsamlı bir derin çalışma eklentisidir. **3 gün ücretsiz deneme** ile gelir; ses dosyası indirmez, streaming yükü üretmez.

| Mod | Sol → Sağ (Hz) | En İyi Kullanım Alanı |
|---|---|---|
| **Beta** | 200 → 214 | Aktif odaklanma, kodlama, görev yürütme |
| **Alpha** | 200 → 210 | Derin öğrenme, sakin uyanıklık, hafıza |
| **Theta** | 180 → 186 | Yaratıcılık, meditasyon, beyin fırtınası |
| **Gamma** | 200 → 240 | Üst düzey bilişsel performans |

İstediğiniz zaman **özel binaural aralık** (0–1000 Hz) belirleyebilirsiniz.

Daha derin uyku ve meditatif modlar da dahildir:

| Mod | Frekans (Hz) | En İyi Kullanım Alanı |
|---|---|---|
| **Delta** | 100 → 102 (Δ2) | Derin onarıcı uyku |
| **Solfeggio 432** | 432 (mono, eş faz) | Sakinlik, topraklanma, "doğal" akort |
| **Solfeggio 528** | 528 (mono, eş faz) | Şifa / "sevgi frekansı", odaklanma |

### Tam Derin Çalışma Döngüsü

- **Nöral Frekans Sinkronizasyonu** — seçtiğiniz mod binaural taşıyıcı frekansı çalıştırır.
- **Akıllı Pomodoro** — 25 dk odaklanma / 5 dk mola. Frekanslar odaklanma fazında **otomatik başlar**, molada **otomatik durur**. Döngü sonunda sakin bir bildirim alırsınız.
- **Derin Çalışma Analitiği** — bugün / bu hafta odaklanma süreleri ve tamamlanan oturumlar sessizce kaydedilir; veriler **yalnızca cihazınızda** tutulur (MV3'te `chrome.storage.local`, düz entegrasyonda `localStorage`).
- **Ambient Mixer** — isteğe bağlı Pink / **Brown** / Rain / White gürültü katmanı (BS129-ilhamlı difüzyon tamponları, çalışma anında üretilir) binaural taşıyıcının altına karışır. Her katmanın kendi aç/kapat düğmesi vardır.
- **Bağımsız ses seviyeleri** — "Binaural / Tone" ve "Ambient Mixer" veri yolu için ayrı kaydırıcı var; tonu ambiyansa karşı bağımsızca kısabilirsiniz.
- **Sentezlenmiş Pomodoro zili** — her odaklanma↔mola geçişinde yumuşak bir D5 gong çalar (ses dosyası yok).
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

### Aktivasyon ve Deneme (12 € / Yıl, Bitcoin — aracısız)

1. FocusBot, **3 günlük sürtünmesiz deneme** ile gelir — lisans, anahtar veya ödeme geçmişi gerekmez. Oynat'a basıp 72 saat dinleyin. Widget alt bilgisi canlı geri sayım rozeti gösterir.
2. Deneme bitince widget kendini kilitler (ses anında durur) ve satın alma penceresini açar.
3. Sürekli dinlemek için **Buy Pro** seçip, fiyat işlemcisi tarafından canlı çevrilen satoshi miktarını gösterilen Bitcoin adresine gönderin — adres **doğrudan geliştiriciye** aittir, aracı yoktur.
4. **TXID**'inizi aktivasyon alanına yapıştırıp **Verify & Activate** deyin: worker zincir üstü ödemeyi doğrular ve 365 günlük lisansı anında verir. Admin API'nin ürettiği lisans anahtarları da aynı şekilde çalışır.

### Güvenlik ve Lisans Sertleştirmesi

- **Sert paywall (istemci)** — doğrulanmış lisans olmadan `AudioContext` **asla oluşturulmaz**; bir bayrağı çevirmek ses grafiğini yeniden inşa etmez.
- **İmzalı engine token** — frekans modülasyon matrisi, faz açıları ve kazanç katsayıları düz metin olarak paketlenmez. Worker, her lisans doğrulamasında bunları **base64url + HMAC-SHA256 imzalı** `engine` token'ı ile döndürür. Bozuk ya da eksik token hiçbir şey vermez; güvenli yedek matrise düşülür.
- **Her sayfa yüklenişinde ve sekmeye dönüşte yeniden doğrulama** — sunucu lisansı onaylamazsa Pro anında iptal edilir.
- **Sıfır telemetri** — analitiğiniz tarayıcıdan asla çıkmaz.
- Ticari dağıtım ayrı lisans kapsamındadır (bkz. Lisans).

### v1.4.0 sürüm öne çıkanları

| Alan | Değişiklik |
|---|---|
| Deneme | **3 günlük sürtünmesiz deneme** (72 saat, canlı sona erme bekçisi, yeniden yüklemelerde kalıcı) |
| Modlar | Yeni **Delta** (100/102) + **Solfeggio 432 Hz** & **528 Hz** (eş faslı mono) |
| Ses | Ambient karıştırıcıya **Brown** gürültü katmanı (pink/brown/rain/white) |
| Karıştırıcı | Bağımsız **Binaural/Tone** + **Ambient** ses seviyesi kaydırıcıları |
| Zil | Her Pomodoro faz geçişinde sentezlenmiş **D5 gong** (ses dosyası yok) |
| Altyapı | Manifest V3 (MV3), sürüm 1.4.0 |
| Sertleştirme | `/api/verify-license` + `/api/verify-tx` üzerinden imzalı `engine` token'ı |

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
npm test         # 67 senaryo, sıfır dış çağrı (Node.js >= 18)
npm run package  # focus-bot-extension.zip'i yeniden üretir (MV3 düz paket)
```

Eklenti paketi (`focus-bot-extension.zip`): `manifest.json`, `focus-bot.js`, `focus-bot.css`, `popup.html`, `popup.js`, `privacy.html` ve dört ikon boyutu.

### Lisans

Ticari Özel Mülkiyet Lisansı. Tüm hakları saklıdır. Kopyalama, yeniden dağıtım veya yeniden satış yasaktır.

### Yasal Uyarı

FocusBot bir ses sentezleme ve verimlilik aracıdır. **Tıbbi cihaz değildir**; herhangi bir bilişsel, nörolojik veya psikiyatrik durumu teşhis veya tedavi etme amacı taşımaz. Blokzincir ödemeleri geri alınamaz — yayınlamadan önce tüm ödeme parametrelerini kontrol edin.