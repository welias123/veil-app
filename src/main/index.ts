import { app, BrowserWindow, WebContentsView, session, protocol, Session } from "electron";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { store } from "./settings";
import { applyShields, invalidateEngine } from "./adblock";
import { applyProxy } from "./proxy";
import { TabManager } from "./tabs";
import { registerIpc, OverlayCtl } from "./ipc";
import { setupDownloads, onDownloadsUpdate } from "./downloads";
import { tor } from "./tor";
import { checkForUpdate, onUpdateProgress, autoDownloadUpdate, applyStagedOnStartup } from "./update";
import { shouldShowWelcome } from "./welcome";
import { IPC, OverlayKind } from "../shared/types";

const RENDERER_DIR = path.join(__dirname, "../renderer");
const CHROME_PRELOAD = path.join(__dirname, "../preload/index.js");
const APP_ICON = path.join(__dirname, "../../build/icon.png");

// --- Privacy hardening: kill Chromium's background phone-home behaviour ---
// None of Chrome's Google-account telemetry ships in Electron, but Chromium
// still has background networking (variations, component/domain-reliability
// pings, hyperlink auditing, autofill server calls). Disable all of it.
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("no-pings"); // no hyperlink auditing
app.commandLine.appendSwitch("disable-breakpad"); // no crash reporting uploads
// Hardware video overlays (Direct Composition) render BLACK when layered with
// transparent views (our overlay). Disabling them keeps video visible.
app.commandLine.appendSwitch("disable-direct-composition-video-overlays");
app.commandLine.appendSwitch(
  "disable-features",
  "Translate,AutofillServerCommunication,OptimizationHints,MediaRouter,InterestFeedContentSuggestions"
);

// The internal veil:// scheme must be privileged (secure origin, fetch, etc.)
// and registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "veil",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/**
 * Serve internal pages/assets from the bundled renderer directory.
 * Must be registered on the SAME session the tabs use — custom protocols are
 * per-session, so registering on the default session would leave the
 * partitioned tab session unable to resolve veil:// (Windows then hands the
 * scheme to the shell → "get an app to open this link").
 */
function registerVeilProtocol(ses: Session) {
  ses.protocol.handle("veil", async (req) => {
    const url = new URL(req.url);
    const host = url.hostname; // e.g. "newtab", "settings"
    const file = url.pathname === "/" || url.pathname === "" ? `${host}.html` : url.pathname.slice(1);
    // Prevent path traversal out of the renderer dir.
    const full = path.normalize(path.join(RENDERER_DIR, file));
    if (!full.startsWith(RENDERER_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const body = await readFile(full);
      return new Response(body, {
        headers: { "content-type": MIME[path.extname(full)] ?? "application/octet-stream" },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

async function configureSession() {
  const ses = session.fromPartition("persist:veil");
  const settings = store.getSettings();

  // Present as plain Chrome — the default Electron UA contains "Electron/…",
  // which Cloudflare/bot-checks (e.g. ChatGPT) block. This makes such sites work.
  const chrome = process.versions.chrome || "134.0.0.0";
  ses.setUserAgent(
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  );

  await applyProxy(ses, settings);
  await applyShields(ses, settings);

  // Fingerprint entropy reduction hint is applied per-page in the content
  // preload; here we strip a couple of high-signal client hint headers.
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const s = store.getSettings();
    if (s.fingerprintProtection) {
      delete details.requestHeaders["Sec-CH-UA-Platform-Version"];
      delete details.requestHeaders["Sec-CH-UA-Full-Version-List"];
    }
    cb({ requestHeaders: details.requestHeaders });
  });

  setupDownloads(ses);
  return ses;
}

function createWindow(): BrowserWindow {
  const settings = store.getSettings();
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 920,
    minHeight: 600,
    show: false,
    frame: false,
    icon: APP_ICON,
    titleBarStyle: "hidden",
    backgroundColor: "#0b0d13",
    titleBarOverlay: { color: "#00000000", symbolColor: "#c7ccd6", height: 40 },
    webPreferences: {
      preload: CHROME_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(RENDERER_DIR, "index.html"));
  win.once("ready-to-show", () => win.show());
  void settings;
  return win;
}

/**
 * Floating panel layer. A transparent, always-on-top WebContentsView that hosts
 * the shields/menu popovers so they are never occluded by the tab views.
 */
function createOverlay(win: BrowserWindow, ses: Session, tabs: TabManager): OverlayCtl {
  const view = new WebContentsView({
    webPreferences: {
      preload: CHROME_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
      transparent: true,
    },
  });
  view.setBackgroundColor("#00000000");
  view.webContents.loadURL("veil://overlay");
  view.setVisible(false);

  // Kept OUT of the view tree while hidden so its transparency doesn't force the
  // compositor to black out hardware video (YouTube). Added only while shown.
  let attached = false;
  const attach = () => { if (!attached) { win.contentView.addChildView(view); attached = true; } };
  const detach = () => { if (attached) { win.contentView.removeChildView(view); attached = false; } };

  const fit = () => {
    if (!attached) return;
    const [w, h] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width: w, height: h });
  };
  win.on("resize", fit);

  let ready = false;
  view.webContents.on("did-finish-load", () => (ready = true));
  let omniMode = false;

  return {
    show(kind: OverlayKind, anchorRight: number) {
      omniMode = false;
      attach();
      fit();
      view.setVisible(true);
      const payload = { kind, anchorRight, domain: hostOf(tabs.activeUrl()) };
      const send = () => view.webContents.send(IPC.overlayShow, payload);
      if (ready) send();
      else view.webContents.once("did-finish-load", send);
      view.webContents.focus();
    },
    hide() {
      view.setVisible(false);
      detach();
      omniMode = false;
    },
    // Omnibox dropdown: position BELOW the toolbar so the address bar stays
    // usable, and overlay the page (which shows through the transparent view).
    // Idempotent — only (re)positions once per open, so live typing doesn't
    // re-insert the view and flicker.
    showOmni(top: number) {
      if (omniMode) return;
      omniMode = true;
      attach();
      const [w, h] = win.getContentSize();
      view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
      view.setVisible(true);
    },
    send(channel: string, payload: unknown) {
      if (!view.webContents.isDestroyed()) view.webContents.send(channel, payload);
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

app.whenReady().then(async () => {
  // Seamless auto-update: if a newer version was staged last session, swap it in
  // and relaunch now before we build anything. (Packaged Windows only.)
  if (applyStagedOnStartup()) return;

  const ses = await configureSession();
  registerVeilProtocol(ses);
  const win = createWindow();
  const tabs = new TabManager(win, ses);
  const overlay = createOverlay(win, ses, tabs);

  registerIpc(win, tabs, ses, overlay);

  // Push download progress to the chrome UI (badge) and overlay (panel).
  onDownloadsUpdate((list) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.downloadsUpdated, list);
    overlay.send(IPC.downloadsUpdated, list);
  });

  // Push update download progress to the overlay (the update modal lives there)
  // and the chrome UI.
  onUpdateProgress((p) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.updateProgress, p);
    overlay.send(IPC.updateProgress, p);
  });

  // Live Tor status (download → bootstrap → ready) to chrome + overlay.
  tor.on("status", (s) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.torStatusUpdated, s);
    overlay.send(IPC.torStatusUpdated, s);
  });

  const applyThemeBg = (theme: string) => {
    const bg = theme === "light" ? "#eceef3" : "#0b0d13";
    if (!win.isDestroyed()) win.setBackgroundColor(bg);
    tabs.setViewBackground(bg);
  };
  applyThemeBg(store.getSettings().theme);

  // React to settings changes: rebuild proxy + shields + Tor live.
  store.on("settings", async (next) => {
    invalidateEngine();
    await applyProxy(ses, next);
    await applyShields(ses, next);
    tor.apply(next); // starts/stops the bundled Tor as needed
    applyThemeBg(next.theme);
  });

  // Start Tor if it was left enabled.
  tor.apply(store.getSettings());

  // First tab.
  tabs.create(process.env.VEIL_DEBUG_URL || undefined);

  // First-run localized welcome (+ macOS manual-update warning) as an in-app
  // glass modal in the overlay — shown once the chrome UI has painted.
  if (shouldShowWelcome()) {
    const showWelcome = () => setTimeout(() => overlay.show("welcome", 0), 700);
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", showWelcome);
    else showWelcome();
  }

  // Check for a newer version, notify the UI (badge/modal), and — in the packaged
  // Windows build — start downloading it in the background so the next launch
  // applies it automatically.
  checkForUpdate().then((info) => {
    if (info && !win.isDestroyed()) win.webContents.send(IPC.updateAvailable, info);
    if (info) autoDownloadUpdate();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => tor.stop());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
