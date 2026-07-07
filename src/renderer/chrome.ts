import { BookmarkItem, DownloadItem, HistoryEntry, OmniItem, Settings, Stats, TabState } from "../shared/types";

/** Minimal typing for the bridge exposed by the chrome preload. */
interface Veil {
  createTab(url?: string): Promise<number>;
  closeTab(id: number): Promise<void>;
  activateTab(id: number): Promise<void>;
  reorderTabs(orderIds: number[]): Promise<void>;
  pinTab(id: number): Promise<void>;
  restoreTab(): Promise<void>;
  go(id: number, input: string): Promise<void>;
  back(id?: number): Promise<void>;
  forward(id?: number): Promise<void>;
  reload(id?: number): Promise<void>;
  stop(id?: number): Promise<void>;
  setLayout(l: { top: number; left: number; right: number; bottom: number }): Promise<void>;
  omniShow(items: OmniItem[], sel: number, top: number): Promise<void>;
  omniHide(): Promise<void>;
  onOmniPicked(cb: (value: string) => void): void;
  openOverlay(kind: "shields" | "menu" | "downloads" | "update", anchorRight: number): Promise<void>;
  onUpdateAvailable(cb: (info: unknown) => void): void;
  zoom(dir: "in" | "out" | "reset"): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  getStats(): Promise<Stats>;
  torStatus(): Promise<{ enabled: boolean; reachable: boolean }>;
  getBookmarks(): Promise<BookmarkItem[]>;
  toggleBookmark(url: string, title: string): Promise<boolean>;
  onBookmarks(cb: (list: BookmarkItem[]) => void): void;
  getHistory(): Promise<HistoryEntry[]>;
  suggest(q: string): Promise<string[]>;
  onTabs(cb: (tabs: TabState[]) => void): void;
  onStats(cb: (stats: Stats) => void): void;
  onSettings(cb: (s: Settings) => void): void;
  onDownloads(cb: (list: DownloadItem[]) => void): void;
}
const veil = (window as any).veil as Veil;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let tabs: TabState[] = [];
let settings: Settings;
let addressFocused = false;
let bookmarks: BookmarkItem[] = [];

const activeTab = () => tabs.find((t) => t.active);
const isBookmarked = (url: string) => bookmarks.some((b) => b.url === url);
function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// ---------- Bookmarks ----------
function updateStar() {
  const t = activeTab();
  const url = t?.url ?? "";
  const on = !!url && isBookmarked(url);
  const icon = $("starIcon");
  icon.setAttribute("fill", on ? "var(--veil-accent)" : "none");
  icon.setAttribute("stroke", on ? "var(--veil-accent)" : "currentColor");
}

function renderBookmarksBar() {
  const bar = $("bookmarksBar");
  bar.innerHTML = "";
  bar.classList.toggle("hidden", bookmarks.length === 0);
  bar.classList.toggle("flex", bookmarks.length > 0);
  for (const b of bookmarks) {
    const el = document.createElement("button");
    el.className = "shrink-0 flex items-center gap-1.5 px-2 h-6 rounded-md hover:bg-white/10 text-xs text-[#c7ccd6] max-w-[180px]";
    el.title = b.url;
    el.innerHTML = `<img src="https://icons.duckduckgo.com/ip3/${hostOf(b.url)}.ico" alt="" class="h-3.5 w-3.5 rounded shrink-0" /><span class="truncate">${escapeHtml(b.title)}</span>`;
    const img = el.querySelector("img")!;
    img.addEventListener("error", () => img.remove());
    el.addEventListener("click", () => { const t = activeTab(); if (t) veil.go(t.id, b.url); });
    el.addEventListener("auxclick", (e) => { if ((e as MouseEvent).button === 1) veil.createTab(b.url); });
    bar.appendChild(el);
  }
  reportLayout();
}

function toggleCurrentBookmark() {
  const t = activeTab();
  if (t?.url) veil.toggleBookmark(t.url, t.title || t.url);
}

// ---------- Omnibox suggestions (rendered in the overlay, over the page) ----------
let historyCache: HistoryEntry[] = [];
let dropItems: OmniItem[] = [];
let dropSel = -1;
let dropOpen = false;

function pushDropdown() {
  if (!dropItems.length) { hideDropdown(); return; }
  const toolbarH = Math.round($("toolbar").getBoundingClientRect().height);
  veil.omniShow(dropItems, dropSel, toolbarH);
  dropOpen = true;
}

function hideDropdown() {
  if (!dropOpen) return;
  dropOpen = false;
  dropSel = -1;
  dropItems = [];
  veil.omniHide();
}

function moveDropSel(delta: number) {
  if (!dropItems.length) return;
  dropSel = (dropSel + delta + dropItems.length) % dropItems.length;
  pushDropdown();
}

async function updateDropdown(input: string) {
  const q = input.trim();
  dropSel = -1;
  if (!q) { hideDropdown(); return; }
  const ql = q.toLowerCase();
  const isUrlish = /^[a-z]+:\/\//i.test(q) || /^[^\s]+\.[^\s]+$/.test(q);
  const hist: OmniItem[] = historyCache
    .filter((h) => h.url.toLowerCase().includes(ql) || h.title.toLowerCase().includes(ql))
    .slice(0, 5)
    .map((h) => ({ title: h.title, sub: h.url, value: h.url, fav: true }));
  const searchItem: OmniItem[] = isUrlish ? [] : [{ title: q, sub: "Veil Suche", value: q }];
  dropItems = [...hist, ...searchItem];
  pushDropdown();

  // Append live search suggestions (ignore if the query changed meanwhile).
  const sugg = await veil.suggest(q).catch(() => [] as string[]);
  if ($<HTMLInputElement>("address").value.trim() !== q) return;
  const suggItems: OmniItem[] = sugg
    .filter((s) => s.toLowerCase() !== ql)
    .slice(0, 5)
    .map((s) => ({ title: s, sub: "Veil Suche", value: s }));
  dropItems = [...hist, ...searchItem, ...suggItems];
  pushDropdown();
}

// ---------- Theme ----------
function hexToRgba(hex: string, a: number): string {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.replace(/(.)/g, "$1$1") : m, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function applyTheme(s: Settings) {
  document.documentElement.classList.toggle("theme-light", s.theme === "light");
  const root = document.documentElement.style;
  root.setProperty("--veil-accent", s.accent);
  root.setProperty("--veil-accent-soft", hexToRgba(s.accent, 0.16));
  root.setProperty("--veil-bg-opacity", String(s.backgroundOpacity));
  root.setProperty("--veil-blur", `${s.blur}px`);
  $("sidebar").style.width = s.sidebarCollapsed ? "0px" : "56px";
  $("sidebar").style.overflow = "hidden";
  reportLayout();
}

// ---------- Layout reporting ----------
function reportLayout() {
  // On a .onion site, inset the web view a few px so the purple Tor frame drawn
  // in the chrome window is visible on ALL sides (not just the top).
  const tor = activeTab()?.isTor ? 3 : 0;
  const top = $("toolbar").getBoundingClientRect().height + tor;
  const left = $("sidebar").getBoundingClientRect().width + tor;
  veil.setLayout({ top: Math.round(top), left: Math.round(left), right: tor, bottom: tor });
}

// ---------- Tabs ----------
function faviconEl(t: TabState): string {
  if (t.loading) {
    return `<span class="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-[var(--veil-accent)] animate-spin"></span>`;
  }
  const letter = (t.title || "?").trim().charAt(0).toUpperCase();
  return `<span class="grid place-items-center h-3.5 w-3.5 text-[9px] font-bold text-white/60">${letter}</span>`;
}

let dragId: number | null = null;

function renderTabs() {
  const host = $("tabs");
  host.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    const base = t.active ? "glass shadow-glass-sm text-white" : "text-[#aeb4c2] hover:bg-white/5";
    el.className = t.pinned
      ? `group animate-tab-in no-drag flex items-center justify-center h-8 w-9 rounded-lg cursor-default shrink-0 ${base}`
      : `group animate-tab-in no-drag flex items-center gap-2 h-8 min-w-[120px] max-w-[220px] px-3 rounded-lg cursor-default ${base}`;
    el.title = t.pinned ? escapeHtml(t.title || "") : "";
    el.draggable = true;
    if (t.pinned) {
      el.innerHTML = faviconEl(t);
    } else {
      el.innerHTML = `
        ${faviconEl(t)}
        <span class="flex-1 truncate text-xs">${escapeHtml(t.title || "Neuer Tab")}</span>
        ${t.isTor ? '<span class="text-[9px] font-bold text-[#b8aeff]">.onion</span>' : ""}
        <button data-close class="opacity-0 group-hover:opacity-100 grid place-items-center h-4 w-4 rounded hover:bg-white/10 shrink-0">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>`;
    }
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-close]")) veil.closeTab(t.id);
      else veil.activateTab(t.id);
    });
    el.addEventListener("dblclick", () => veil.pinTab(t.id)); // pin/unpin
    el.addEventListener("auxclick", (e) => {
      if ((e as MouseEvent).button === 1 && !t.pinned) veil.closeTab(t.id); // middle-click close
    });
    // Drag to reorder.
    el.addEventListener("dragstart", () => { dragId = t.id; });
    el.addEventListener("dragover", (e) => e.preventDefault());
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragId === null || dragId === t.id) return;
      const order = tabs.map((x) => x.id).filter((id) => id !== dragId);
      const at = order.indexOf(t.id);
      order.splice(at, 0, dragId);
      dragId = null;
      veil.reorderTabs(order);
    });
    host.appendChild(el);
  }
}

function syncOmnibox() {
  const t = activeTab();
  const input = $<HTMLInputElement>("address");
  if (!addressFocused) input.value = t?.url ?? "";
  $("torBadge").classList.toggle("hidden", !t?.isTor);
  // Onion mode: purple address bar + full window border (removed when leaving).
  document.documentElement.classList.toggle("tor-mode", !!t?.isTor);
  reportLayout(); // update the Tor inset so the frame shows on all sides
  updateStar();
  // Security icon: lock for https, warning for http.
  const secure = (t?.url ?? "").startsWith("https://") || (t?.url ?? "") === "";
  $("secIcon").innerHTML = secure
    ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
    : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e0a33e" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
  $<HTMLButtonElement>("back").disabled = !t?.canGoBack;
  $<HTMLButtonElement>("forward").disabled = !t?.canGoForward;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

// ---------- Stats ----------
function renderStats(stats: Stats) {
  const el = $("shieldCount");
  el.textContent = formatCount(stats.requestsBlocked);
  el.classList.remove("count-pop");
  void el.offsetWidth; // restart animation
  el.classList.add("count-pop");
}
function formatCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

// ---------- Overlay panels ----------
/** Open the floating shields/menu panel, anchored under its toolbar button. */
function openPanel(kind: "shields" | "menu" | "downloads", btnId: string) {
  const rect = $(btnId).getBoundingClientRect();
  const anchorRight = Math.round(window.innerWidth - rect.right);
  veil.openOverlay(kind, anchorRight);
}

// ---------- Wiring ----------
function wire() {
  $("newTab").onclick = () => veil.createTab();
  $("sideNewTab").onclick = () => veil.createTab();
  $("sideHome").onclick = () => activeTab() && veil.go(activeTab()!.id, "veil://newtab");
  $("sideSettings").onclick = () => veil.createTab("veil://settings");
  $("sideCollapse").onclick = () => veil.setSettings({ sidebarCollapsed: !settings.sidebarCollapsed });

  $("back").onclick = () => veil.back();
  $("forward").onclick = () => veil.forward();
  $("reload").onclick = () => veil.reload();

  const addr = $<HTMLInputElement>("address");
  addr.addEventListener("focus", () => {
    addressFocused = true;
    addr.select();
    veil.getHistory().then((h) => (historyCache = h)); // keep suggestions fresh
  });
  addr.addEventListener("blur", () => {
    addressFocused = false;
    // Delay so a click on a suggestion still registers.
    setTimeout(() => hideDropdown(), 150);
    syncOmnibox();
  });
  let dropTimer = 0;
  addr.addEventListener("input", () => {
    // Debounce so typing never lags behind the suggestion work / network.
    clearTimeout(dropTimer);
    const v = addr.value;
    dropTimer = window.setTimeout(() => updateDropdown(v), 110);
  });
  addr.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveDropSel(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveDropSel(-1); }
    else if (e.key === "Enter") {
      const chosen = dropSel >= 0 ? dropItems[dropSel]?.value : addr.value;
      const t = activeTab();
      if (t && chosen) veil.go(t.id, chosen);
      hideDropdown();
      addr.blur();
    } else if (e.key === "Escape") {
      hideDropdown();
      addr.blur();
    }
  });

  $("shieldBtn").onclick = () => openPanel("shields", "shieldBtn");
  $("menuBtn").onclick = () => openPanel("menu", "menuBtn");
  $("downloadBtn").onclick = () => openPanel("downloads", "downloadBtn");
  $("starBtn").onclick = () => toggleCurrentBookmark();

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && (e.key === "T" || e.key === "t")) veil.restoreTab();
    else if (mod && e.key === "t") veil.createTab();
    else if (mod && e.key === "w") activeTab() && veil.closeTab(activeTab()!.id);
    else if (mod && e.key === "r") veil.reload();
    else if (mod && e.key === "l") $<HTMLInputElement>("address").focus();
    else if (mod && e.key === ",") veil.createTab("veil://settings");
    else if (mod && e.key === "j") openPanel("downloads", "downloadBtn");
    else if (mod && e.key === "h") veil.createTab("veil://history");
    else if (mod && e.key === "d") toggleCurrentBookmark();
    else if (mod && (e.key === "+" || e.key === "=")) veil.zoom("in");
    else if (mod && e.key === "-") veil.zoom("out");
    else if (mod && e.key === "0") veil.zoom("reset");
    else if (e.altKey && e.key === "ArrowLeft") veil.back();
    else if (e.altKey && e.key === "ArrowRight") veil.forward();
    else return;
    e.preventDefault();
  });

  new ResizeObserver(reportLayout).observe($("toolbar"));
  new ResizeObserver(reportLayout).observe($("sidebar"));
  window.addEventListener("resize", reportLayout);
}

// ---------- Init ----------
async function init() {
  settings = await veil.getSettings();
  applyTheme(settings);
  renderStats(await veil.getStats());
  wire();
  reportLayout();

  veil.onTabs((next) => {
    tabs = next;
    renderTabs();
    syncOmnibox();
  });
  veil.onStats((s) => renderStats(s));
  veil.onSettings((s) => {
    settings = s;
    applyTheme(s);
  });

  // Bookmarks
  bookmarks = await veil.getBookmarks();
  renderBookmarksBar();
  updateStar();
  veil.onBookmarks((list) => {
    bookmarks = list;
    renderBookmarksBar();
    updateStar();
  });

  // History cache for omnibox suggestions.
  historyCache = await veil.getHistory();
  veil.onOmniPicked((value) => {
    if (value) { const t = activeTab(); if (t) veil.go(t.id, value); }
    hideDropdown();
    $<HTMLInputElement>("address").blur();
  });

  // Downloads badge + a small pulse when a download completes.
  let lastDone = 0;
  veil.onDownloads((list) => {
    const active = list.some((d) => d.state === "progressing");
    const done = list.filter((d) => d.state === "completed").length;
    $("dlBadge").classList.toggle("hidden", !active && done === lastDone);
    if (done > lastDone) {
      const btn = $("downloadBtn");
      btn.classList.remove("count-pop");
      void btn.offsetWidth;
      btn.classList.add("count-pop");
    }
    lastDone = done;
  });

  // Show the update window when a newer version is available.
  veil.onUpdateAvailable(() => veil.openOverlay("update", 0));

  // Reflect Tor availability in the badge tooltip.
  const tor = await veil.torStatus();
  if (tor.enabled && !tor.reachable) {
    $("torBadge").title = "Tor aktiviert, aber SOCKS-Port nicht erreichbar";
  }
}

init();
