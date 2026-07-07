// Shared type contracts between the main process and renderer(s).

export type ShieldLevel = "aggressive" | "standard" | "off";

export interface Settings {
  // Privacy / Shields
  shieldLevel: ShieldLevel;
  blockScripts: boolean;
  fingerprintProtection: boolean;
  httpsEverywhere: boolean;
  blockCookieBanners: boolean;
  // Per-site shield pause: domains where blocking is disabled.
  allowlist: string[];
  // Tor
  torEnabled: boolean;
  torSocksPort: number;
  routeAllThroughTor: boolean;
  // Search
  searchEngine: string; // key into SEARCH_ENGINES
  // Theme engine
  theme: "dark" | "light"; // accent stays purple either way
  accent: string; // hex
  backgroundOpacity: number; // 0..1
  blur: number; // px
  // Layout
  sidebarCollapsed: boolean;
  // Veil AI (Anthropic). Key is provided by the user; empty = AI disabled.
  aiApiKey: string;
  aiModel: string;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiReply {
  text?: string;
  error?: string;
}

export interface Stats {
  trackersBlocked: number;
  adsBlocked: number;
  bytesSaved: number;
  // Derived time saved is computed from blocked count; stored for continuity.
  requestsBlocked: number;
}

export interface TabState {
  id: number;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isTor: boolean;
  active: boolean;
  pinned: boolean;
}

/** Chrome layout the renderer reports so main can position web content views. */
export interface ChromeLayout {
  top: number; // toolbar height
  left: number; // sidebar width
  right: number;
  bottom: number;
}

export type OverlayKind = "shields" | "menu" | "downloads" | "update";

export interface UpdateInfo {
  version: string;
  notes: string;
  url: string;
}

export type UpdatePhase = "downloading" | "extracting" | "ready" | "error";

export interface UpdateProgress {
  phase: UpdatePhase;
  version: string;
  percent: number; // 0..100
  received: number; // bytes
  total: number; // bytes (0 if unknown)
  speed: number; // bytes/sec
  error?: string;
}

export interface StagedUpdateInfo {
  version: string;
}

export interface OmniItem {
  title: string;
  sub: string;
  value: string;
  fav?: boolean;
}

export interface OverlayContext {
  kind: OverlayKind;
  domain: string; // current tab's host, for per-site shield toggle
  anchorRight: number; // px from right edge to anchor the panel under its button
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface VideoResult {
  title: string;
  url: string;
  thumbnail: string;
  duration: string;
  publisher: string;
}

export interface NewsResult {
  title: string;
  url: string;
  excerpt: string;
  source: string;
  date: number;
}

export type SearchKind = "web" | "videos" | "news";

export interface HistoryEntry {
  url: string;
  title: string;
  time: number;
}

export interface BookmarkItem {
  url: string;
  title: string;
  time: number;
}

export type TorPhase = "off" | "downloading" | "starting" | "bootstrapping" | "ready" | "error";

export interface TorRuntimeStatus {
  enabled: boolean;
  reachable: boolean;
  phase: TorPhase;
  progress: number; // 0..100 (download or bootstrap)
  message: string;
}

export type DownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  state: DownloadState;
  received: number;
  total: number;
  path: string;
  startTime: number;
  speed: number; // bytes per second (current)
  paused: boolean;
}

export interface SearchEngine {
  name: string;
  url: string; // %s is replaced with the query
  suggest?: string;
}

export const SEARCH_ENGINES: Record<string, SearchEngine> = {
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/sp/search?query=%s" },
  google: { name: "Google", url: "https://www.google.com/search?q=%s" },
  ecosia: { name: "Ecosia", url: "https://www.ecosia.org/search?q=%s" },
};

export const DEFAULT_SETTINGS: Settings = {
  shieldLevel: "standard",
  blockScripts: false,
  // Off by default for maximum site compatibility (can trigger bot-checks on
  // e.g. ChatGPT/Gemini or misclick banners). Users can enable in Shields.
  fingerprintProtection: false,
  httpsEverywhere: true,
  blockCookieBanners: false,
  allowlist: [],
  torEnabled: false,
  torSocksPort: 9050,
  routeAllThroughTor: false,
  searchEngine: "duckduckgo",
  theme: "dark",
  accent: "#7c6cff",
  backgroundOpacity: 0.72,
  blur: 22,
  sidebarCollapsed: false,
  aiApiKey: "",
  aiModel: "claude-haiku-4-5-20251001",
};

export const DEFAULT_STATS: Stats = {
  trackersBlocked: 0,
  adsBlocked: 0,
  bytesSaved: 0,
  requestsBlocked: 0,
};

// IPC channel names, centralized to avoid string drift.
export const IPC = {
  // renderer -> main (invoke)
  tabCreate: "tab:create",
  tabClose: "tab:close",
  tabActivate: "tab:activate",
  tabReorder: "tab:reorder",
  tabPin: "tab:pin",
  tabRestore: "tab:restore",
  tabTranslate: "tab:translate",
  navGo: "nav:go",
  navBack: "nav:back",
  navForward: "nav:forward",
  navReload: "nav:reload",
  navStop: "nav:stop",
  layoutSet: "layout:set",
  contentHidden: "content:hidden", // hide/show active web view (omnibox dropdown)
  overlayOpen: "overlay:open", // chrome -> main: show floating panel
  overlayClose: "overlay:close", // overlay/chrome -> main: hide panel
  overlayShow: "overlay:show", // main -> overlay: which panel + context
  omniShow: "omni:show", // chrome -> main: show suggestion list {items, sel, top}
  omniHide: "omni:hide", // chrome -> main
  omniData: "omni:data", // main -> overlay: {items, sel}
  omniPick: "omni:pick", // overlay -> main: value ("" = just close)
  omniPicked: "omni:picked", // main -> chrome: navigate to value
  zoom: "nav:zoom", // in | out | reset on active tab
  downloadsGet: "dl:get",
  downloadOpen: "dl:open",
  downloadShow: "dl:show",
  downloadsClear: "dl:clear",
  downloadCancel: "dl:cancel", // stop an in-progress download
  downloadPause: "dl:pause",
  downloadResume: "dl:resume",
  downloadUrl: "dl:url", // start a direct download of a URL (no navigation)
  downloadsUpdated: "dl:updated", // main -> renderer
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  statsGet: "stats:get",
  statsReset: "stats:reset",
  searchQuery: "search:query",
  aiChat: "ai:chat",
  historyGet: "history:get",
  historyAdd: "history:add",
  historyDelete: "history:delete",
  historyClear: "history:clear",
  bookmarksGet: "bm:get",
  bookmarkToggle: "bm:toggle",
  bookmarkRemove: "bm:remove",
  bookmarksUpdated: "bm:updated",
  torStatus: "tor:status",
  torStatusUpdated: "tor:status-updated", // main -> renderer (live bootstrap)
  setDefaultBrowser: "sys:set-default",
  isDefaultBrowser: "sys:is-default",
  winPrint: "win:print",
  winFullscreen: "win:fullscreen",
  clearData: "win:clear-data",
  quitApp: "win:quit",
  updateAvailable: "update:available", // main -> chrome
  updateGet: "update:get",
  updateDownload: "update:download", // start in-app download+extract
  updateApply: "update:apply", // swap files + restart
  updateStaged: "update:staged", // query staged (downloaded) version
  updateProgress: "update:progress", // main -> renderer: live download progress
  // main -> renderer (send)
  tabsUpdated: "tabs:updated",
  statsUpdated: "stats:updated",
  settingsUpdated: "settings:updated",
  openSettings: "ui:open-settings",
} as const;
