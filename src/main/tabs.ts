import { BrowserWindow, WebContentsView, Session } from "electron";
import { EventEmitter } from "node:events";
import path from "node:path";
import { ChromeLayout, IPC, SEARCH_ENGINES, TabState } from "../shared/types";
import { store } from "./settings";
import { isOnion, checkTor } from "./proxy";
import { history } from "./history";
import { markYouTubeContents } from "./adblock";

// One unified preload for every tab; it self-gates by origin (privileged API
// only on veil://, privacy protections on real sites).
const TAB_PRELOAD = path.join(__dirname, "../preload/index.js");

export const INTERNAL = {
  newtab: "veil://newtab",
  settings: "veil://settings",
  torError: "veil://error",
  connecting: "veil://connecting",
};

function isInternal(url: string): boolean {
  return url.startsWith("veil://");
}

/** The set of keyboard chords Veil owns (forwarded from page views to the UI). */
function isVeilShortcut(input: Electron.Input): boolean {
  const mod = input.control || input.meta;
  const k = input.key.toLowerCase();
  if (input.alt && (input.key === "ArrowLeft" || input.key === "ArrowRight")) return true;
  if (!mod) return false;
  if (input.shift) return k === "t" || k === "n"; // restore tab, new private window
  return ["t", "w", "r", "l", ",", "j", "h", "d", "+", "=", "-", "0"].includes(k);
}

/** Turn an omnibox input into a navigable URL (search vs. address vs. onion). */
export function resolveInput(input: string): string {
  const raw = input.trim();
  if (!raw) return INTERNAL.newtab;
  if (isInternal(raw)) return raw;

  // Looks like a URL already?
  if (/^[a-z]+:\/\//i.test(raw)) return raw;

  // Bare .onion or domain-ish token with a dot and no spaces -> treat as URL.
  const looksLikeHost =
    /^[^\s]+\.[^\s]+$/.test(raw) && !raw.includes(" ");
  if (looksLikeHost) {
    return (raw.endsWith(".onion") ? "http://" : "https://") + raw;
  }

  // Otherwise: search with Veil's own engine, or the chosen external one.
  const s = store.getSettings();
  if (!s.useVeilSearch) {
    const eng = SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.duckduckgo;
    return eng.url.replace("%s", encodeURIComponent(raw));
  }
  return `veil://search?q=${encodeURIComponent(raw)}`;
}

interface Tab {
  id: number;
  view: WebContentsView;
  pinned: boolean;
}

/** Google Translate proxy URL for the current page (translate.goog). */
function toTranslateUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (url.hostname.endsWith(".translate.goog")) return null; // already translated
    const host = url.hostname.replace(/-/g, "--").replace(/\./g, "-");
    const sep = url.search ? "&" : "?";
    const tl = store.getSettings().translateTarget || "de";
    return `https://${host}.translate.goog${url.pathname}${url.search}${sep}_x_tr_sl=auto&_x_tr_tl=${tl}&_x_tr_hl=${tl}`;
  } catch {
    return null;
  }
}

export class TabManager extends EventEmitter {
  private tabs: Tab[] = [];
  private activeId = -1;
  private seq = 1;
  private closedStack: string[] = []; // recently closed tab URLs (for restore)
  private layout: ChromeLayout = { top: 88, left: 0, right: 0, bottom: 0 };
  // When a page enters HTML fullscreen (e.g. a YouTube video), the active view
  // covers the entire window (toolbar + sidebar hidden) and the OS window goes
  // fullscreen for a true, chromeless experience.
  private fullscreen = false;
  // Temporarily hides the active web view (e.g. while the omnibox suggestion
  // dropdown is open) so chrome-window UI isn't occluded by the native view.
  private contentHidden = false;
  private viewBg = "#0b0d13"; // flash background, follows the theme

  constructor(private win: BrowserWindow, private session: Session) {
    super();
    this.win.on("resize", () => this.relayout());
  }

  get active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  create(url = INTERNAL.newtab, activate = true): number {
    const view = new WebContentsView({
      webPreferences: {
        preload: TAB_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: this.session,
        autoplayPolicy: store.getSettings().blockAutoplay
          ? "document-user-activation-required"
          : "no-user-gesture-required",
      },
    });

    // Themed view background prevents a mismatched flash between navigations.
    view.setBackgroundColor(this.viewBg);

    const id = this.seq++;
    const tab: Tab = { id, view, pinned: false };
    this.tabs.push(tab);
    this.wire(tab);

    // Apply the user's default zoom once the first page has loaded.
    view.webContents.once("did-finish-load", () => {
      try { view.webContents.setZoomFactor(store.getSettings().defaultZoom || 1); } catch {}
    });

    this.win.contentView.addChildView(view);
    this.load(id, url);

    if (activate) this.activate(id);
    this.emitTabs();
    return id;
  }

  private wire(tab: Tab) {
    const wc = tab.view.webContents;
    const push = () => this.emitTabs();

    wc.on("page-title-updated", (_e, title) => {
      if (store.getSettings().saveHistory) history.add(wc.getURL(), title);
      push();
    });
    wc.on("page-favicon-updated", push);
    wc.on("did-start-loading", push);
    wc.on("did-stop-loading", push);
    // Track whether this tab is on YouTube so the adblocker can skip it.
    const updateYouTube = () => {
      let host = "";
      try { host = new URL(wc.getURL()).hostname; } catch { /* internal */ }
      markYouTubeContents(wc.id, /(^|\.)youtube\.com$|(^|\.)youtu\.be$|youtube-nocookie\.com$/.test(host));
    };
    wc.on("did-navigate", () => { updateYouTube(); push(); });
    wc.on("did-navigate-in-page", () => { updateYouTube(); push(); });
    wc.once("destroyed", () => markYouTubeContents(wc.id, false));

    // Open target=_blank / window.open as new tabs instead of popups.
    wc.setWindowOpenHandler(({ url }) => {
      if (!store.getSettings().blockPopups) this.create(url);
      return { action: "deny" };
    });

    // True fullscreen for HTML5 video etc. — cover the whole window + go OS
    // fullscreen, then restore the chrome on exit.
    wc.on("enter-html-full-screen", () => {
      this.fullscreen = true;
      this.win.setFullScreen(true);
      this.relayout();
    });
    wc.on("leave-html-full-screen", () => {
      this.fullscreen = false;
      this.win.setFullScreen(false);
      this.relayout();
    });

    // .onion routing is automatic: if it fails because Tor isn't ready yet, send
    // the tab to the auto-connect page (which enables + downloads + bootstraps
    // Tor, then returns). If Tor IS ready and it still failed, the onion is
    // genuinely unreachable.
    wc.on("did-fail-load", async (_e, code, _desc, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3 /* aborted */) return;
      if (!isOnion(validatedURL)) return;
      if (wc.getURL().startsWith("veil://")) return; // already on an internal page

      const s = store.getSettings();
      const torReady = s.torEnabled && (await checkTor(s.torSocksPort));
      if (torReady) {
        wc.loadURL(INTERNAL.torError);
      } else {
        wc.loadURL(`${INTERNAL.connecting}?u=${encodeURIComponent(validatedURL)}`);
      }
    });

    // Shortcuts must work even while a web page holds focus: catch Veil's chord
    // keys here (on the page view) and forward them to the chrome UI, which owns
    // the shortcut logic. Any non-Veil key passes straight through to the page.
    wc.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      if (isVeilShortcut(input)) {
        event.preventDefault();
        this.win.webContents.send(IPC.shortcut, {
          key: input.key,
          control: input.control || input.meta,
          shift: input.shift,
          alt: input.alt,
        });
      }
    });
  }

  /** Hide/show the active web view (omnibox dropdown, without moving layout). */
  setContentHidden(hidden: boolean) {
    this.contentHidden = hidden;
    this.relayout();
  }

  /** Update the flash/background color of all tab views (theme change). */
  setViewBackground(color: string) {
    this.viewBg = color;
    for (const tab of this.tabs) tab.view.setBackgroundColor(color);
  }

  /** Zoom the active tab in/out/reset. */
  zoom(dir: "in" | "out" | "reset") {
    const wc = this.active?.view.webContents;
    if (!wc) return;
    if (dir === "reset") return wc.setZoomFactor(1);
    const z = wc.getZoomFactor();
    wc.setZoomFactor(Math.min(3, Math.max(0.5, z + (dir === "in" ? 0.1 : -0.1))));
  }

  load(id: number, input: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const url = resolveInput(input);
    if (url === INTERNAL.newtab) tab.view.webContents.loadURL(INTERNAL.newtab);
    else if (url === INTERNAL.settings) tab.view.webContents.loadURL(INTERNAL.settings);
    else tab.view.webContents.loadURL(url).catch(() => {/* surfaced via events */});
  }

  activate(id: number) {
    if (!this.tabs.some((t) => t.id === id)) return;
    this.activeId = id;
    // Only the active view is visible; others are moved off-screen.
    this.relayout();
    this.emitTabs();
  }

  close(id: number) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [tab] = this.tabs.splice(idx, 1);
    // Remember non-internal URLs so they can be restored (Ctrl+Shift+T).
    const url = tab.view.webContents.getURL();
    if (/^https?:\/\//i.test(url)) this.closedStack.push(url);
    this.win.contentView.removeChildView(tab.view);
    (tab.view.webContents as any).destroy?.();

    if (this.activeId === id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1];
      if (next) this.activate(next.id);
      else this.create(); // never leave zero tabs
    }
    this.emitTabs();
  }

  /** Reopen the most recently closed tab. */
  restoreClosed() {
    const url = this.closedStack.pop();
    if (url) this.create(url);
  }

  /** Reorder tabs to match the given id order (from drag & drop). */
  reorder(orderIds: number[]) {
    const map = new Map(this.tabs.map((t) => [t.id, t]));
    const next = orderIds.map((id) => map.get(id)).filter((t): t is Tab => !!t);
    // Keep any tabs not in the list (shouldn't happen) at the end.
    for (const t of this.tabs) if (!orderIds.includes(t.id)) next.push(t);
    this.tabs = next;
    this.emitTabs();
  }

  /** Pin/unpin a tab; pinned tabs are kept before unpinned ones. */
  togglePin(id: number) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    // Stable sort: pinned first, preserving relative order.
    this.tabs = [...this.tabs.filter((t) => t.pinned), ...this.tabs.filter((t) => !t.pinned)];
    this.emitTabs();
  }

  /** Open a Google-translated version of the active tab. */
  translate(id = this.activeId) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const tu = toTranslateUrl(tab.view.webContents.getURL());
    if (tu) tab.view.webContents.loadURL(tu).catch(() => {});
  }

  back(id = this.activeId) {
    const wc = this.tabs.find((t) => t.id === id)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }
  forward(id = this.activeId) {
    const wc = this.tabs.find((t) => t.id === id)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }
  reload(id = this.activeId) {
    this.tabs.find((t) => t.id === id)?.view.webContents.reload();
  }
  stop(id = this.activeId) {
    this.tabs.find((t) => t.id === id)?.view.webContents.stop();
  }

  setLayout(layout: ChromeLayout) {
    this.layout = layout;
    this.relayout();
  }

  /** Current active tab URL (used to derive the domain for per-site shields). */
  activeUrl(): string {
    return this.active?.view.webContents.getURL() ?? "";
  }

  private relayout() {
    const [w, h] = this.win.getContentSize();
    const { top, left, right, bottom } = this.layout;
    const bounds = this.fullscreen
      ? { x: 0, y: 0, width: w, height: h }
      : {
          x: left,
          y: top,
          width: Math.max(0, w - left - right),
          height: Math.max(0, h - top - bottom),
        };
    for (const tab of this.tabs) {
      if (tab.id === this.activeId) {
        tab.view.setVisible(!this.contentHidden);
        tab.view.setBounds(bounds);
      } else {
        tab.view.setVisible(false);
      }
    }
  }

  serialize(): TabState[] {
    const settings = store.getSettings();
    return this.tabs.map((t) => {
      const wc = t.view.webContents;
      const url = wc.getURL();
      return {
        id: t.id,
        title: wc.getTitle() || "Neuer Tab",
        url: url.startsWith("veil://") ? "" : url,
        favicon: null,
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        isTor: isOnion(url) || (settings.torEnabled && settings.routeAllThroughTor),
        active: t.id === this.activeId,
        pinned: t.pinned,
      };
    });
  }

  private emitTabs() {
    this.emit("updated", this.serialize());
  }
}
