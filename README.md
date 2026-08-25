# FOCUS-BOT

**Real-Time Neural Beat Synthesizer & On-Chain Cognitive Flow Accelerator**

> FOR COGNITIVE MODULATION & RESEARCH USE. NO AUDIO SAMPLES BUFFERED. ZERO EXTERNAL SOUND ASSETS.

---

## English

### Overview

FOCUS-BOT is an edge-native, zero-dependency browser synthesis platform designed to induce target cognitive states (Alpha, Beta, Theta, Gamma) via client-side phase-shifted binaural oscillations and harmonic soundwaves. Unlike traditional white-noise tools that stream static MP3/WAV files, FOCUS-BOT synthesizes raw waveform audio directly on the client machine using native Web Audio API oscillators, ensuring sub-millisecond modulation control and zero bandwidth overhead.

The platform is strictly paywalled through a serverless, non-custodial licensing infrastructure hosted on Cloudflare Workers and verified on-chain via the Bitcoin network.

### Key Features

- **Real-Time Client-Side Synthesis:** Native mathematical waveform generation without pre-recorded sound assets or external audio streaming.
- **Dynamic On-Chain Verification:**
  - Auto-pegged to €12.00 / year, evaluated dynamically into satoshis at request time via CoinGecko / Mempool failover.
  - Instant on-chain verification via mempool.space API.
- **Strict Underpayment Immunity:** Rejects underpaid transactions (402 Insufficient Amount) without granting access.
- **Anti-Replay Defense:** TXIDs permanently locked in Cloudflare KV (409 Conflict).
- **Cognitive Frequency Spectra:**
  - **Beta (13–30 Hz):** Active concentration, task execution, coding flow.
  - **Alpha (8–13 Hz):** Deep learning, relaxed alertness, memory consolidation.
  - **Theta (4–8 Hz):** Creativity, meditation, lateral problem-solving.
  - **Gamma (30–100 Hz):** High-level neuro-synchronization and cognitive binding.
- **Granular Modulation:** Precision oscillator sweep controls from 0.1 Hz to 1000 Hz.
- **Edge-Native License Verification:** Global low-latency domain & license validation via Cloudflare Workers KV.

### Repository Structure

```
focus-bot/
├── .github/workflows/     # CI: automated test runner & syntax checks
├── client/                # Frontend application & synthesis core
│   ├── index.html         # User landing page & audio controls
│   ├── focus-bot.js       # Web Audio synthesizer, event loop & worker bridge
│   └── focus-bot.css      # Dark-mode UI styling & payment modal
├── worker/                # Serverless licensing gateway (Cloudflare)
│   ├── index.js           # REST API: pricing, mempool verifier, license generator
│   └── wrangler.toml      # Worker config, KV bindings, allowed origins
├── tests/                 # Zero-dependency test suite (Node.js)
│   └── suite.js           # Security, pricing, underpayment & double-spend assertions
├── run-tests.js           # CLI test runner
├── package.json           # Node scripts and configs
└── README.md
```

### Installation & Quickstart

**Prerequisites**

- Node.js 18.0+
- Python 3.10+ (for local client preview)
- Cloudflare Wrangler CLI (`npm install -g wrangler`)

```bash
git clone https://github.com/YOUR_USERNAME/focus-bot.git
cd focus-bot
npm install
```

**Run the Edge Backend (Worker)**

```bash
cd worker
npx wrangler kv namespace create LICENSES
# Update wrangler.toml with the returned ID and your BTC_ADDRESS
npx wrangler deploy
```

**Run the Frontend Locally**

```bash
cd ../client
python -m http.server 5500
```

Open `http://localhost:5500` in your browser.

**Run Test Suite**

```bash
# In the root directory:
node run-tests.js
```

### API Specification

| Endpoint | Method | Description | Auth |
|---|---|---|---|
| `/api/health` | GET | Edge worker uptime verification | None |
| `/api/pricing` | GET | Fetches live BTC/EUR exchange metrics & required satoshis | None |
| `/api/verify-tx` | POST | Validates on-chain TXID and issues a 365-day Pro license | None |
| `/api/verify-license` | POST | Validates active domain and license key integrity | None |
| `/api/admin/grant` | POST | Manual license issuance | Bearer ADMIN_TOKEN |

### Security & Compliance

| Layer | Implementation |
|---|---|
| Authentication | Bearer token validation with constant-time cryptographic comparison |
| Rate Limiting | Sliding-window request throttling on Cloudflare KV |
| CORS Policy | Explicit origin whitelisting (ALLOWED_ORIGINS) |
| Transaction Guard | Atomically locked `tx:<TXID>` keys preventing double activations |
| Amount Enforcement | Strict multi-output satoshi aggregation against dynamic rate target |

### Roadmap

- [x] Web Audio binaural frequency engine
- [x] Cloudflare Worker edge licensing API
- [x] Dynamic €12/year BTC satoshi converter with KV caching
- [x] Mempool.space on-chain transaction verifier
- [x] Strict underpayment (402) and replay (409) guards
- [x] 11/11 automated unit & integration tests
- [ ] Presets for Pomodoro-integrated wave sweeps
- [ ] Hardware-accelerated Web Audio visualizer (Canvas/WebGL)
- [ ] Lightning Network (L402 / LNURL) instant payment support

### License

Proprietary Commercial Software. All rights reserved. See LICENSE.

### Legal Disclaimer

FOCUS-BOT is a scientific sound synthesis and productivity utility. It is not a medical device and is not intended to diagnose, treat, or cure any cognitive, neurological, or psychiatric conditions. Bitcoin transactions are irreversible; verify payment parameters before broadcasting.

---

## Türkçe

### Genel Bakış

FOCUS-BOT, harici ses dosyaları kullanmadan doğrudan istemci tarafında faz kaydırmalı binaural vuruşlar ve harmonik ses dalgaları üreterek hedeflenen bilişsel durumları (Alpha, Beta, Teta, Gama) tetikleyen sıfır bağımlılıklı nöral ses sentezleme platformudur. Standart ses oynatıcılarının aksine, tarayıcının yerel Web Audio API osilatörlerini kullanarak gecikmesiz modülasyon sağlar ve bant genişliği harcamaz.

Platform, Cloudflare Workers üzerinde barındırılan ve doğrudan Bitcoin blokzinciri üzerinden doğrulanan merkeziyetsiz bir ödeme ve lisanslama mimarisiyle korunmaktadır.

### Temel Özellikler

- **Gerçek Zamanlı İstemci Sentezi:** Önceden kaydedilmiş ses dosyası (MP3/WAV) olmadan doğrudan matematiksel dalga formu üretimi.
- **Dinamik Blokzincir Doğrulaması:**
  - Yıllık 12.00 € sabit kur; CoinGecko/Mempool üzerinden anlık satoshi miktarına dönüştürülür.
  - mempool.space API üzerinden otomatik on-chain transfer kontrolü.
- **Eksik Ödeme Koruması:** 1 satoshi dahi eksik transferlerde işlemi anında reddeder (402 Insufficient Amount).
- **Tekrar Engelleme (Anti-Replay):** Doğrulanan TXID'ler Cloudflare KV'ye kalıcı olarak işlenir (409 Conflict).
- **Bilişsel Frekans Aralıkları:**
  - **Beta (13–30 Hz):** Aktif odaklanma, problem çözme, kodlama akışı.
  - **Alpha (8–13 Hz):** Derin öğrenme, sakin uyanıklık, hafıza pekiştirme.
  - **Theta (4–8 Hz):** Yaratıcılık, meditasyon, serbest çağrışım.
  - **Gamma (30–100 Hz):** Üst düzey bilişsel entegrasyon ve kavrayış.
- **Hassas Modülasyon:** 0.1 Hz – 1000 Hz aralığında hassas frekans kontrolü.
- **Uç Ağda Lisanslama:** Cloudflare Workers KV ile küresel düşük gecikmeli lisans denetimi.

### Depo Yapısı

```
focus-bot/
├── .github/workflows/     # CI: otomatik testler ve sözdizimi denetimi
├── client/                # İstemci uygulaması ve ses motoru
│   ├── index.html         # Kullanıcı arayüzü ve ses kontrolleri
│   ├── focus-bot.js       # Web Audio sentezleyici ve API köprüsü
│   └── focus-bot.css      # Koyu tema stilleri ve ödeme penceresi
├── worker/                # Sunucusuz lisans ağ geçidi (Cloudflare)
│   ├── index.js           # REST API: fiyatlandırma, doğrulama, lisans üretimi
│   └── wrangler.toml      # Worker ayarları, KV tanımları, origin izinleri
├── tests/                 # Bağımsız test paketi (Node.js)
│   └── suite.js           # Güvenlik, fiyatlandırma, eksik ödeme testleri
├── run-tests.js           # Test çalıştırıcı betik
├── package.json           # Proje paket yapılandırması
└── README.md
```

### Kurulum ve Başlangıç

**Ön Gereksinimler**

- Node.js 18.0+
- Python 3.10+ (yerel test sunucusu için)
- Cloudflare Wrangler CLI (`npm install -g wrangler`)

```bash
git clone https://github.com/YOUR_USERNAME/focus-bot.git
cd focus-bot
npm install
```

**Backend'i (Worker) Canlıya Alma**

```bash
cd worker
npx wrangler kv namespace create LICENSES
# wrangler.toml dosyasına dönen ID'yi ve BTC_ADDRESS bilginizi ekleyin
npx wrangler deploy
```

**İstemciyi Yerelde Çalıştırma**

```bash
cd ../client
python -m http.server 5500
```

Tarayıcınızdan `http://localhost:5500` adresini açın.

**Testleri Çalıştırma**

```bash
# Ana dizindeyken:
node run-tests.js
```

### Güvenlik ve Uyumluluk

| Katman | Uygulama |
|---|---|
| Kimlik Doğrulama | Sabit süreli kriptografik karşılaştırmalı Bearer token |
| Hız Sınırlama | Cloudflare KV kayan pencere istek sınırlaması |
| CORS Politikası | Açık origin beyaz listesi (ALLOWED_ORIGINS) |
| İşlem Güvenliği | Çift harcamayı önleyen atomik `tx:<TXID>` kayıtları |
| Tutar Denetimi | Anlık kur hedefine göre çoklu vout satoshi toplamı denetimi |

### Yol Haritası

- [x] Web Audio binaural frekans sentezleyicisi
- [x] Cloudflare Worker lisanslama API'si
- [x] 12€/yıl dinamik BTC dönüştürücü ve KV önbelleği
- [x] Mempool.space blokzincir doğrulayıcısı
- [x] Eksik bakiye (402) ve tekrar kullanım (409) kontrolleri
- [x] 11/11 kapsamlı otomatik test paketi
- [ ] Pomodoro entegrasyonlu dalga profilleri
- [ ] WebGL/Canvas tabanlı gerçek zamanlı ses görselleştirici
- [ ] Lightning Network (L402) anında ödeme desteği

### Lisans

Ticari Özel Mülkiyet Lisansı. Tüm hakları saklıdır. LICENSE dosyasına bakın.

### Yasal Uyarı

FOCUS-BOT bir odaklanma ve akustik modülasyon aracıdır. Tıbbi cihaz niteliği taşımaz; herhangi bir nörolojik veya psikiyatrik rahatsızlığı teşhis veya tedavi etme amacı taşımaz. Blokzincir transferleri geri döndürülemez; ödeme yapmadan önce transfer parametrelerinizi kontrol ediniz.
