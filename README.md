<div align="center">

<h1>⚡ CodeShare</h1>

<p><strong>Free real-time collaborative code editor — built for classrooms</strong></p>

<p>
  <a href="https://codeshare-218h.onrender.com"><img src="https://img.shields.io/badge/Live%20Demo-codeshare--218h.onrender.com-2f81f7?style=for-the-badge&logo=render&logoColor=white" alt="Live Demo" /></a>
  &nbsp;
  <a href="https://github.com/kasamthapa/codeshare"><img src="https://img.shields.io/badge/Open%20Source-GitHub-161b22?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" /></a>
  &nbsp;
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js ≥18" />
  &nbsp;
  <img src="https://img.shields.io/badge/License-MIT-98c379?style=for-the-badge" alt="MIT License" />
</p>

<p>
  <a href="https://codeshare-218h.onrender.com"><strong>→ Try it live</strong></a> &nbsp;·&nbsp;
  <a href="#-getting-started">Quick Start</a> &nbsp;·&nbsp;
  <a href="#-deploy-your-own">Deploy</a> &nbsp;·&nbsp;
  <a href="#-faq">FAQ</a>
</p>

<br />

</div>

---

CodeShare is a **no-login, password-protected collaborative code editor** you can spin up for a classroom, interview, or team session in under a minute. Multiple people edit the same code simultaneously — with live cursors, in-room chat, and a built-in code runner. No accounts. No setup for participants. Just share a room name and password.

---

## ✨ Features

| | Feature | Details |
|---|---|---|
| ⚡ | **Real-time editing** | All keystrokes sync instantly via Socket.io. Live cursors show exactly where each collaborator is. |
| ▶ | **Built-in code runner** | Run Python, JavaScript, Java, C++, and C# directly in the browser — powered by [Wandbox](https://wandbox.org), no API key needed. |
| 📁 | **Multi-file tabs** | Each room starts with 6 language files. Create, rename, and delete files collaboratively. |
| 🔒 | **Password-protected rooms** | Rooms are private by default. No participant needs an account. |
| 👑 | **Host access control** | Switch the room between *edit* and *view-only* mode. Grant or revoke edit access per user. |
| 💬 | **In-room chat** | Built-in chat panel with typing indicators — no external service needed. |
| 📱 | **QR code sharing** | Generate a QR code from the toolbar for instant phone joins. |
| 💾 | **MongoDB persistence** | Room code survives server restarts when `MONGODB_URI` is set (optional). |
| 🎨 | **One Dark theme** | CodeMirror 6 editor with the One Dark theme and Fira Code font. |
| 📲 | **PWA** | Installable as a Progressive Web App on desktop and mobile. |

---

## 🖥️ Languages Supported

| Language | Syntax Highlighting | Code Execution |
|---|:---:|:---:|
| 🐍 Python | ✅ | ✅ |
| 🟨 JavaScript | ✅ | ✅ |
| ☕ Java | ✅ | ✅ |
| ⚙️ C++ | ✅ | ✅ |
| 💜 C# | ✅ | ✅ |
| 📄 Plain Text | — | — |

---

## 🚀 Getting Started

### Run locally in 3 steps

```bash
# 1. Clone
git clone https://github.com/kasamthapa/codeshare.git
cd codeshare

# 2. Install & build the CodeMirror bundle
npm install

# 3. Start
node server.js
```

Open **http://localhost:3000**, create a room, and share the URL with your team.

> **Requirements:** Node.js ≥ 18

---

## ⚙️ Configuration

All settings are optional. The app runs fully in-memory with no external dependencies by default.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port to listen on |
| `NODE_ENV` | `development` | Set to `production` to enable caching headers |
| `SITE_URL` | *(empty)* | Your public URL — sets canonical, Open Graph, sitemap, and robots URLs (e.g. `https://codeshare-218h.onrender.com`) |
| `MONGODB_URI` | *(none)* | MongoDB connection string. If unset, rooms live in memory only and don't survive restarts. |

---

## ☁️ Deploy Your Own

### Render *(recommended — free tier, no CLI needed)*

1. Fork this repo
2. Go to [render.com](https://render.com) → **New → Web Service** → connect your fork
3. Render detects `render.yaml` automatically — click **Deploy**
4. Add `SITE_URL` in **Environment → Add Environment Variable**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

---

### Fly.io

```bash
fly launch          # first time — prompts for app name and region
fly deploy          # subsequent updates
fly secrets set SITE_URL=https://your-app.fly.dev
```

Edit `fly.toml` to change the region (`sin` = Singapore, `bom` = Mumbai, `lax` = Los Angeles).

---

### Docker

```bash
# Build
docker build -t codeshare .

# Run
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e SITE_URL=https://your-domain.com \
  -e MONGODB_URI=mongodb+srv://... \
  codeshare
```

The Dockerfile uses a two-stage build — the CodeMirror bundle is compiled in stage 1, and only production dependencies are included in the final image (~120 MB).

---

## 🗂️ Project Structure

```
codeshare/
├── server.js          # Express + Socket.io server, REST API, Wandbox proxy
├── src/
│   └── editor.js      # CodeMirror 6 barrel export (bundled by esbuild)
├── public/
│   ├── index.html     # Landing page — create / join a room
│   ├── room.html      # Editor UI — tabs, toolbar, chat, output panel
│   ├── cm.bundle.js   # Built CodeMirror bundle (generated — not committed)
│   └── manifest.json  # PWA manifest
├── build.js           # esbuild config — outputs public/cm.bundle.js
├── Dockerfile         # Two-stage Docker build
├── fly.toml           # Fly.io deployment config
└── render.yaml        # Render.com deployment config
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Server | [Node.js](https://nodejs.org) + [Express](https://expressjs.com) |
| Real-time | [Socket.io 4](https://socket.io) |
| Editor | [CodeMirror 6](https://codemirror.net) |
| Bundler | [esbuild](https://esbuild.github.io) |
| Code runner | [Wandbox API](https://wandbox.org) |
| Database | [MongoDB](https://mongodb.com) (optional) |
| Security | [Helmet](https://helmetjs.github.io) + [compression](https://github.com/expressjs/compression) |
| Hosting | [Render](https://render.com) / [Fly.io](https://fly.io) / Docker |

---

## ❓ FAQ

<details>
<summary><strong>Do participants need an account?</strong></summary>

No. Participants only need the room name and password. No sign-up, no email, nothing.
</details>

<details>
<summary><strong>Is the code saved after everyone leaves?</strong></summary>

Yes — if `MONGODB_URI` is set, the room's files are saved to MongoDB automatically. Without it, the room is held in memory and is lost when the last user disconnects.
</details>

<details>
<summary><strong>How does code execution work?</strong></summary>

The server proxies the code to [Wandbox](https://wandbox.org), a free online compiler service. No API key is required. The compiler list is refreshed every 12 hours to stay current.
</details>

<details>
<summary><strong>Can I limit who can edit the code?</strong></summary>

Yes. The host can switch the room to **view-only** mode from the toolbar, then grant edit access to individual users on request.
</details>

<details>
<summary><strong>How many users can join a room?</strong></summary>

The server is configured for up to 200 simultaneous connections (adjustable in `fly.toml` / your platform settings). Socket.io handles fan-out efficiently — typical classroom sizes (20–40 users) run comfortably on the smallest free-tier VM.
</details>

---

## 🤝 Contributing

Pull requests are welcome.

```bash
git clone https://github.com/kasamthapa/codeshare.git
cd codeshare
npm install
node server.js      # dev server — no build watcher needed for server changes
```

For frontend changes that touch `src/editor.js`, rebuild the bundle:

```bash
node build.js
```

---

## 📄 License

MIT © [Kasam Thapa Magar](https://github.com/kasamthapa)

---

<div align="center">
  <sub>Built with ⚡ for classrooms · <a href="https://codeshare-218h.onrender.com">Live Demo</a></sub>
</div>
