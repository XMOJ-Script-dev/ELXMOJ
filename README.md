# Electro-XMOJ

A desktop application for [XMOJ](https://www.xmoj.tech/) built with [Electron](https://www.electronjs.org/), porting all features from [XMOJ-Script](https://github.com/XMOJ-Script-dev/XMOJ-Script) as a native app instead of a userscript.

## Features

- 🖥️ **Native desktop app** — no browser extension or userscript manager required
- 🔄 **Auto-injects the latest XMOJ enhancement script** from GitHub on every launch
- 📋 **Native clipboard** — copy samples, code, and problem content via the system clipboard
- 🔔 **Native OS notifications** — BBS & private message popups via the OS notification centre
- 🍪 **Cookie management** — session cookie handling via Electron's session API
- ⚙️ **Settings window** — toggle all XMOJ-Script features through a native settings panel
- 🧭 **Navigation menu** — quick links to Problem Set, Status, Contests, Discussion, etc.
- 💾 **Persistent settings** — preferences are saved and applied across sessions
- 🌗 **Theme support** — light / dark / system theme

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- [npm](https://www.npmjs.com/) (bundled with Node.js)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/XMOJ-Script-dev/Electro-XMOJ.git
cd Electro-XMOJ

# Install dependencies
npm install

# Start the application
npm start
```

## How It Works

| Component | Purpose |
|---|---|
| `src/main.js` | Electron main process — creates the window, tray, menus, IPC handlers |
| `src/preload.js` | Runs in the renderer context — injects GM_* shims then fetches & injects XMOJ.user.js |
| `src/settings/index.html` | Native settings panel |
| `src/settings/preload.js` | Bridge from settings window to main process |

On launch the app opens `https://www.xmoj.tech/` in a full browser window.  
`preload.js` then:
1. Defines a compatibility layer for all `GM_*` / `GM.*` Greasemonkey APIs used by the script.
2. Fetches the latest `XMOJ.user.js` from GitHub and injects it into every page as a `<script>` tag.
3. All enhancement features (UI beautification, auto-login, code editor, contest tools, notifications, …) work exactly as they do in the userscript version.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

