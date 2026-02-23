# void AI — Next-Gen Chat Interface

> A blazing-fast, beautiful AI chatbot powered by [Groq](https://groq.com) with 5 dark themes, multimodal support, and PWA installability.

![AURA AI](screenshots/screen1.png)

---

## ✨ Features

- **⚡ Groq-Powered** — Ultra-fast inference via Groq's LPU
- **🔑 Multi-Key Rotation** — Add multiple API keys; auto-rotates on rate limits
- **🌌 5 Dark Themes** — Nebula, Void, Obsidian, Aurora, Crimson
- **📱 PWA Installable** — Works offline, installable on mobile/desktop
- **👁️ Multimodal** — Attach images to conversations (vision models)
- **📊 Dashboard** — Stats, quick prompts, recent chats
- **💾 Persistent** — All data saved to localStorage (survives reload/exit)
- **🎨 Streaming** — Real-time token streaming with live markdown rendering
- **📐 Fully Responsive** — Optimized for mobile, tablet, and desktop

---

## 🚀 Quick Start

### Option 1 — GitHub Pages (recommended)

1. Fork this repo
2. Go to **Settings → Pages → Deploy from branch → main**
3. Visit `https://yourusername.github.io/aura-ai/`

### Option 2 — Local

```bash
git clone https://github.com/yourusername/aura-ai.git
cd aura-ai
# Serve with any static file server:
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080`

> **Note:** Must be served over HTTPS or localhost for the Service Worker (PWA) to work.

---

## 🔑 Getting a Groq API Key

1. Visit [console.groq.com](https://console.groq.com)
2. Create a free account
3. Go to **API Keys → Create API Key**
4. Paste the key into AURA's onboarding screen

### Key Rotation

Add multiple keys in Settings → API Keys. When one key hits its rate limit (HTTP 429), AURA automatically switches to the next available key.

---

## 🌌 Themes

| Theme | Accent | Vibe |
|-------|--------|------|
| **Nebula** | Purple `#7c6fff` | Cosmic, ethereal |
| **Void** | White `#ffffff` | Minimal, stark |
| **Obsidian** | Gold `#d4af37` | Luxury, refined |
| **Aurora** | Teal `#00e5a0` | Natural, organic |
| **Crimson** | Red `#ff3d5a` | Bold, passionate |

---

## 🤖 Supported Models

| Model | Speed | Context | Vision |
|-------|-------|---------|--------|
| Llama 3.3 70B Versatile | Fast | 128K | ❌ |
| Llama 3.1 8B Instant | Blazing | 128K | ❌ |
| Llama 3 70B | Fast | 8K | ❌ |
| Mixtral 8x7B | Medium | 32K | ❌ |
| Gemma 2 9B | Fast | 8K | ❌ |
| Llama 3.2 11B Vision | Fast | 128K | ✅ |
| Llama 3.2 90B Vision | Medium | 128K | ✅ |

---

## 🏗️ Architecture

```
aura-ai/
├── index.html          # App shell, all views
├── style.css           # All styles + 5 theme variables
├── app.js              # All app logic
├── sw.js               # Service Worker (PWA/offline)
├── manifest.json       # PWA manifest
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── screenshots/
    └── screen1.png
```

Pure HTML/CSS/JS — zero dependencies, zero build step.

---

## 📱 Installing as PWA

### Chrome / Edge (Desktop)
- Click the install icon in the address bar
- Or visit the app and click the install banner

### iOS Safari
- Tap **Share → Add to Home Screen**

### Android Chrome
- Tap **Menu → Install App** or use the banner

---

## ⚙️ Configuration

All settings are in the **Settings panel** (gear icon):

- **API Keys** — Add/remove keys
- **Default Model** — Select inference model
- **Temperature** — Creativity (0 = deterministic, 2 = chaotic)
- **Max Tokens** — Response length limit
- **Streaming** — Enable/disable real-time streaming
- **System Prompt** — Customize AURA's personality

---

## 🔒 Privacy

- API keys are stored **only in your browser's localStorage**
- No data is sent anywhere except directly to Groq's API
- No analytics, no tracking, no ads

---

## 📄 License

MIT — use freely, attribution appreciated.

---

Made with ❤️ and way too much CSS
