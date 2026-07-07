# Veil Browser

A modern, privacy-first desktop browser built on **Electron + TypeScript + Tailwind CSS**.
Minimal, dark, glassmorphism UI — with native Tor routing, Brave-style Shields, and a
beautiful analytics new-tab page.

![icon](icon.svg)

## Features

- **Dual-Routing-Engine** — normal traffic goes direct; `.onion` hosts are routed through a
  local Tor SOCKS proxy via a PAC script (optionally route *all* traffic through Tor).
- **Shields (ad/tracker blocker)** — high-performance native blocking powered by the
  Ghostery engine (network + cosmetic filtering). Three levels: aggressive / standard / off.
- **HTTPS Everywhere** — automatic http→https upgrades.
- **Cookie-banner handling** — auto-dismiss / reject consent popups.
- **Fingerprint protection** — canvas noise, reduced device entropy, WebGL vendor masking.
- **Analytics dashboard** — live counters for trackers/ads blocked, bandwidth saved, and
  time saved, on the new-tab page.
- **Theme engine** — custom accent colors, background opacity, blur strength (live preview).
- **Extended settings** — search-engine management, shield tuning, Tor config, collapsible
  sidebar, keyboard shortcuts.

## Architecture

```
src/
  main/        Electron main process
    index.ts     app lifecycle, veil:// protocol, session wiring
    tabs.ts      tab manager (one WebContentsView per tab) + URL resolution
    adblock.ts   Ghostery engine + stats + HTTPS/script shields
    proxy.ts     Tor PAC routing + SOCKS reachability check
    settings.ts  persisted settings/stats store (electron-store)
    ipc.ts       IPC bridge main <-> chrome UI
  preload/
    chrome.ts    privileged bridge (window.veil) for the UI + internal pages
    content.ts   per-tab fingerprint protection + cookie-banner handling
  renderer/
    index.html/.ts     browser chrome (tabs, omnibox, sidebar, shields)
    newtab.html/.ts     analytics dashboard
    settings.html/.ts   settings screens
  shared/types.ts        shared contracts + IPC channel names
```

The chrome UI is a frameless window. Each tab is a native `WebContentsView` composited into
the transparent content region; the renderer reports its layout so the main process positions
the active view.

## Development

```bash
npm install
npm run build      # bundle main/preload/renderer (esbuild) + compile Tailwind
npm start          # launch Electron
# or, one-shot:
npm run app
# watch mode:
npm run dev        # in one terminal
npm start          # in another
```

## Tor setup

Veil does **not** bundle a Tor daemon (yet) — it routes to a local Tor SOCKS port. To use
`.onion` sites:

1. Install Tor (e.g. the Tor Expert Bundle) and start it so it listens on `127.0.0.1:9050`.
2. In Veil → Settings → **Tor-Routing**, enable Tor. The status dot turns green when the
   SOCKS port is reachable.
3. Navigate to any `.onion` address; it is transparently routed through Tor.

The configured port is adjustable in settings. Enabling *"route all traffic through Tor"*
sends clearnet traffic through Tor as well (slower, more private).

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+R` | Reload |
| `Ctrl+L` | Focus address bar |
| `Ctrl+,` | Open settings |
| `Alt+←/→` | Back / forward |

## Notes / roadmap

- Bandwidth and time-saved figures are **estimates** (blocked requests never receive a
  response). Tune `AVG_BLOCKED_BYTES` / `MS_PER_BLOCK` to taste.
- Next steps: bundle a Tor binary for zero-config onion routing, tab drag-reordering,
  history/bookmarks, per-site shield overrides, and packaging via `npm run dist`.
