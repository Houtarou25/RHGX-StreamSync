# ⚡ HoutarouBot (RHGX StreamSync)

> **Next-Gen Multi-Platform AI Live Stream Assistant & Streamer.bot Integration Hub**  
> Powered by Google Gemini AI, Streamer.bot WebSocket API, and Node.js.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18.0%2B-green.svg?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![Streamer.bot](https://img.shields.io/badge/Streamer.bot-v1.0.7%2B-blueviolet.svg?style=for-the-badge)](https://streamer.bot)
[![Google Gemini](https://img.shields.io/badge/Google%20Gemini-Flash%20AI-orange.svg?style=for-the-badge&logo=google)](https://ai.google.dev)
[![Ko-fi Support](https://img.shields.io/badge/Ko--fi-Support%20Houtarou25-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/houtarou25)

---

## 🌟 Overview

**HoutarouBot** is a high-performance, self-hosted streaming assistant designed to run alongside your existing bots (like BotRix, Nightbot, and StreamElements) without conflicts. 

It connects your live stream chat across **Kick**, **Twitch**, and **YouTube Gaming** directly to **Google Gemini AI**, providing interactive viewer chat replies, custom AI personas, viewer virtual currency minigames, automated Ko-fi donation alerts, and OBS overlay triggers.

---

## ✨ Features

- 🌐 **Tri-Platform Live Chat Routing**: Universal parser and dispatcher for **Kick**, **Twitch**, and **YouTube** using Streamer.bot's WebSocket API.
- 🧠 **Google Gemini AI Multi-Persona Engine**:
  - Switch on-the-fly between: **Friendly Companion**, **Tsundere Rival**, **Hype / Gamer**, **Chaotic Gremlin**, **Cynical / Sarcastic**, or **Sensei / Zen**.
  - Built-in token-saving prompt engineering keeping responses punchy, fast, and conversational.
  - Custom Streamer lore / PC specs / FAQ knowledge injection.
- 🛡️ **Zero-Downtime API Auto-Retry**: Built-in exponential backoff retry loop for Google servers (handling 503 overload and 429 rate limit errors smoothly without dropping chat).
- 🎮 **Viewer Economy & Minigames**:
  - Automated points accrual per minute watched.
  - `!points` — Check viewer balance.
  - `!gamble <amount>` — 5-outcome dice roll with configurable multipliers.
  - `!heist <amount>` — Co-op bank heist minigame with join countdowns.
- ☕ **Live Ko-fi Donation Webhook & Alerts**:
  - Native Ko-fi webhook receiver (`POST /api/kofi-webhook`) supporting secret verification token.
  - Instant live chat announcement and animated OBS overlay triggers for stream tips.
- 🎛️ **Cyberpunk Glassmorphism Web Dashboard**:
  - Real-time connection telemetry (Streamer.bot, OBS, Gemini API status).
  - Live color-coded terminal log stream.
  - One-click configuration sync and runtime restart.
- 🔊 **Action Redemptions**:
  - Trigger Streamer.bot soundboards, OBS filters, or lighting cues directly from chat commands (e.g. `!redeem sus`).
- 🎨 **OBS Studio Overlay Source**:
  - Hardware-accelerated browser source (`overlay.html`) listening on WebSocket port `8081` for pop-up donation banners and AI speech bubbles.

---

## 🏗️ Architecture

```
                       ┌─────────────────────────┐
                       │   Live Stream Viewers   │
                       │ (Kick / Twitch / YouTube)│
                       └────────────┬────────────┘
                                    │ Live Chat Messages
                                    ▼
                       ┌─────────────────────────┐
                       │   Streamer.bot (v1.0.7) │
                       │    WebSocket :9001      │
                       └────────────┬────────────┘
                                    │ Chat Events / Dispatches
                                    ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      HoutarouBot Node.js Server                         │
 │                                                                        │
 │  ┌─────────────────┐   ┌─────────────────┐   ┌──────────────────────┐  │
 │  │ Chat Router &   │   │ Gemini AI Engine│   │ Economy & Database   │  │
 │  │ Rate Limiter    │   │ (ai.js)         │   │ (points.json)        │  │
 │  └────────┬────────┘   └────────┬────────┘   └──────────┬───────────┘  │
 │           │                     │                       │              │
 │           ▼                     ▼                       ▼              │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │              Local HTTP & WebSocket Server (:8081)               │  │
 │  └──────────────────────────────┬───────────────────────────────────┘  │
 └─────────────────────────────────┼──────────────────────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   ┌──────────────────────┐                  ┌──────────────────────┐
   │ OBS Browser Overlay  │                  │ Cyberpunk Dashboard  │
   │    (overlay.html)    │                  │   (dashboard.html)   │
   └──────────────────────┘                  └──────────────────────┘
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (Version 18.0.0 or higher)
- [Streamer.bot](https://streamer.bot/) (v1.0.7 or higher)
- A free [Google Gemini API Key](https://aistudio.google.com/app/apikey)

### 2. Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/HoutarouBot.git
   cd HoutarouBot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Launch the bot:
   ```bash
   npm start
   ```

4. Open your browser and navigate to:
   - **Landing Page**: [http://localhost:8081](http://localhost:8081)
   - **Dashboard**: [http://localhost:8081/dashboard.html](http://localhost:8081/dashboard.html)

5. Paste your **Gemini API Key** in the Dashboard, customize your bot trigger (e.g. `!bot`), select an AI persona, and click **"Save All Settings"**.

---

## ⚙️ Streamer.bot Setup

HoutarouBot connects to Streamer.bot's WebSocket server to listen to incoming chat and dispatch replies.

### Step 1: Enable Streamer.bot WebSocket Server
1. In Streamer.bot, navigate to the **Servers/Clients** tab -> **WebSocket Server**.
2. Set Address to `127.0.0.1` and Port to `9001`.
3. Check **Auto Start** and click **Start Server**.

### Step 2: Create the Universal Reply Action
To allow HoutarouBot to reply across all platforms (Kick, Twitch, YouTube):
1. In Streamer.bot, go to the **Actions** tab and create a new Action named:  
   `HoutarouBot-ReplyAction`
2. Add Sub-Actions:
   - **Twitch** -> **Chat** -> **Send Message to Channel** (`%message%`)
   - **YouTube** -> **Chat** -> **Send Message to Live Chat** (`%message%`)
   - **Kick** -> **Chat** -> **Send Message to Channel** (`%message%`)
3. Check the condition so each sub-action executes only when the respective platform matches, or let Streamer.bot route it to your active connected accounts.

---

## 🎥 OBS Studio Overlay Setup

1. In OBS Studio, click `+` under **Sources** and select **Browser**.
2. Name it `HoutarouBot Overlay`.
3. Set the URL to:
   ```
   http://localhost:8081/overlay.html
   ```
4. Set Width to `1920` and Height to `1080`.
5. Check **Shutdown source when not visible** and **Refresh browser when scene becomes active**.
6. Click **OK**.

---

## ☕ Ko-fi Donation Webhook Setup

1. Log into your [Ko-fi](https://ko-fi.com) creator dashboard.
2. Go to **Settings** -> **API & Webhooks**.
3. Under **Webhook URL**, set:
   ```
   https://YOUR_DOMAIN_OR_NGROK/api/kofi-webhook
   ```
   *(For local testing without a domain, use [ngrok](https://ngrok.com) or [localtunnel](https://localtunnel.me) to forward port `8081`)*.
4. Copy your **Verification Token** and paste it into the HoutarouBot Dashboard under **Ko-fi Verification Token**.
5. When a viewer donates, HoutarouBot will:
   - Announce the donation in live stream chat.
   - Pop up an animated high-roller tip banner on your OBS stream overlay.

---

## 💬 Chat Commands

| Command | Description | Example |
| :--- | :--- | :--- |
| `!bot <text>` | Ask the AI assistant a question | `!bot what game are we playing?` |
| `!points` | Check your virtual coin balance | `!points` |
| `!gamble <amount>` | Roll the dice to double or lose coins | `!gamble 100` |
| `!heist <amount>` | Start or join a co-op bank heist | `!heist 500` |
| `!socials` | Output streamer's social media links | `!socials` |
| `!donate` / `!kofi` | Display the streamer's donation page | `!donate` |
| `!redeem <word>` | Trigger configured Streamer.bot actions | `!redeem sus` |

---

## 📁 Project Structure

```
HoutarouBot/
├── server.js              # Core Node.js HTTP & WebSocket server, chat router
├── ai.js                  # Google Gemini AI integration, persona prompts & retry loop
├── minigames.js           # Viewer points, gambling & heist minigame mechanics
├── database.js            # In-memory JSON persistent economy database
├── config.example.json    # Default template configuration file
├── index.html             # Futuristic landing page with animated particles & sound
├── dashboard.html         # Cyberpunk configuration dashboard & live log monitor
├── overlay.html           # OBS Studio interactive alert overlay
├── package.json           # Node dependencies and npm scripts
├── .gitignore             # Git ignore rules (protects keys and viewer data)
└── LICENSE                # MIT License
```

---

## 🔒 Security & Privacy

- **API Keys**: Your Google Gemini API key and Ko-fi verification token are stored locally in `config.json`, which is excluded from git tracking via `.gitignore`.
- **Database**: Viewer coin records are stored locally in `points.json` and are never shared or sent to any cloud server.

---

## 💖 Support the Developer

If you find HoutarouBot useful for your streams, consider buying me a coffee to support continued open-source development:

[![Buy Me A Coffee](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/houtarou25)

**Created with ❤️ by [Houtarou25](https://ko-fi.com/houtarou25)**

---

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).
