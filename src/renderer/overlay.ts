import { DownloadItem, OmniItem, OverlayContext, Settings, StagedUpdateInfo, Stats, UpdateInfo, UpdateProgress } from "../shared/types";

/** Floating panel layer (shields + menu + downloads). Rendered in its own
 *  always-on-top WebContentsView so it is never occluded by the native tab view. */
interface Veil {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  getStats(): Promise<Stats>;
  resetStats(): Promise<Stats>;
  reload(id?: number): Promise<void>;
  createTab(url?: string): Promise<number>;
  zoom(dir: "in" | "out" | "reset"): Promise<void>;
  getDownloads(): Promise<DownloadItem[]>;
  openDownload(id: string): Promise<void>;
  showDownload(id: string): Promise<void>;
  clearDownloads(): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  pauseDownload(id: string): Promise<void>;
  resumeDownload(id: string): Promise<void>;
  onDownloads(cb: (list: DownloadItem[]) => void): void;
  closeOverlay(): Promise<void>;
  onOverlayShow(cb: (ctx: OverlayContext) => void): void;
  onStats(cb: (s: Stats) => void): void;
  omniPick(value: string): Promise<void>;
  onOmniData(cb: (d: { items: OmniItem[]; sel: number }) => void): void;
  print(): Promise<void>;
  toggleFullscreen(): Promise<void>;
  clearData(): Promise<void>;
  quit(): Promise<void>;
  getUpdate(): Promise<UpdateInfo | null>;
  getStagedUpdate(): Promise<StagedUpdateInfo | null>;
  downloadUpdate(): Promise<string>;
  applyUpdate(): Promise<boolean>;
  onUpdateProgress(cb: (p: UpdateProgress) => void): void;
  downloadUrl(url: string): Promise<void>;
  translatePage(): Promise<void>;
  platform: string;
}
const veil = (window as any).veil as Veil;
const $ = (id: string) => document.getElementById(id)!;

let settings: Settings;
let stats: Stats;
let downloads: DownloadItem[] = [];
let ctx: OverlayContext;

// Update-modal state machine: available → downloading → ready (or error).
type UpState = "available" | "downloading" | "ready" | "error";
let up: { state: UpState; info: UpdateInfo | null; progress: UpdateProgress | null; error: string } = {
  state: "available",
  info: null,
  progress: null,
  error: "",
};

function close() {
  veil.closeOverlay();
}

function h(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function fmt(n: number): string {
  return n.toLocaleString("de-DE");
}

function isPaused(): boolean {
  return !!ctx.domain && settings.allowlist.includes(ctx.domain);
}

// ---------- Shields panel (Brave-style) ----------
function renderShields(): HTMLElement {
  const paused = isPaused();
  const p = h(`<div class="glass rounded-xl2 shadow-glass w-80 overflow-hidden"></div>`);

  p.appendChild(h(`
    <div class="flex items-center gap-2.5 px-5 pt-5 pb-4">
      <span id="shield-icon" class="grid place-items-center h-8 w-8 rounded-lg" style="background:var(--veil-accent-soft);color:var(--veil-accent)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </span>
      <div class="leading-tight">
        <div class="text-sm font-semibold">Veil Shields</div>
        <div class="text-xs text-[#8b93a3] truncate max-w-[190px]">${ctx.domain || "diese Seite"}</div>
      </div>
    </div>`));

  // Big per-site toggle
  const bigToggle = h(`
    <div class="mx-4 mb-3 px-4 py-3 rounded-xl bg-black/30 flex items-center justify-between cursor-pointer">
      <div>
        <div class="text-sm font-medium">${paused ? "Shields sind aus" : "Shields sind an"}</div>
        <div class="text-xs text-[#8b93a3]">für ${ctx.domain || "diese Seite"}</div>
      </div>
      <span class="relative h-6 w-11 rounded-full shrink-0 transition-colors ${paused ? "bg-white/12" : ""}" style="${paused ? "" : "background:var(--veil-accent)"}">
        <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style="left:${paused ? "2px" : "22px"}"></span>
      </span>
    </div>`);
  bigToggle.addEventListener("click", togglePause);
  p.appendChild(bigToggle);

  // Global blocked count
  p.appendChild(h(`
    <div class="mx-5 mb-3 flex items-center justify-between">
      <span class="text-xs text-[#9aa0ad]">Insgesamt blockiert</span>
      <span class="text-sm font-semibold tabular-nums" style="color:var(--veil-accent)">${fmt(stats.requestsBlocked)}</span>
    </div>`));

  // Advanced controls (dimmed while paused)
  const adv = h(`<div class="border-t border-white/5 px-5 py-3 space-y-1 ${paused ? "opacity-40 pointer-events-none" : ""}"></div>`);
  const levels: [Settings["shieldLevel"], string][] = [["aggressive", "Aggressiv"], ["standard", "Standard"], ["off", "Aus"]];
  const seg = h(`<div class="grid grid-cols-3 gap-1 p-1 rounded-lg bg-black/30 mb-1"></div>`);
  for (const [k, label] of levels) {
    const on = settings.shieldLevel === k;
    const b = h(`<button class="text-xs py-1.5 rounded-md ${on ? "text-white" : "text-[#9aa0ad]"}" style="${on ? "background:var(--veil-accent)" : ""}">${label}</button>`);
    b.addEventListener("click", () => save({ shieldLevel: k }));
    seg.appendChild(b);
  }
  adv.appendChild(seg);
  adv.appendChild(toggleRow("fingerprintProtection", "Fingerprint-Schutz"));
  adv.appendChild(toggleRow("httpsEverywhere", "HTTPS erzwingen"));
  adv.appendChild(toggleRow("blockCookieBanners", "Cookie-Banner blocken"));
  adv.appendChild(toggleRow("blockScripts", "Skripte blockieren"));
  p.appendChild(adv);

  return p;
}

function toggleRow(key: keyof Settings, label: string): HTMLElement {
  const on = settings[key] as boolean;
  const row = h(`<div class="flex items-center justify-between py-1.5 cursor-pointer">
    <span class="text-xs text-[#c7ccd6]">${label}</span>
    <span class="relative h-4 w-7 rounded-full transition-colors ${on ? "" : "bg-white/12"}" style="${on ? "background:var(--veil-accent)" : ""}">
      <span class="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all" style="left:${on ? "14px" : "2px"}"></span>
    </span></div>`);
  row.addEventListener("click", () => save({ [key]: !(settings[key] as boolean) } as any));
  return row;
}

// ---------- Menu panel ----------
function renderMenu(): HTMLElement {
  const p = h(`<div class="glass rounded-xl2 shadow-glass w-64 p-1.5"></div>`);
  const item = (label: string, shortcut: string, fn: () => void, danger = false) => {
    const el = h(`<button class="w-full flex items-center justify-between text-left text-sm px-3 py-2 rounded-lg hover:bg-white/5 ${danger ? "text-[#ff8b9e]" : "text-[#d6dae2]"}">
      <span>${label}</span><span class="text-[10px] text-[#5b6473]">${shortcut}</span></button>`);
    el.addEventListener("click", fn);
    return el;
  };
  const sep = () => h(`<div class="my-1 border-t border-white/5"></div>`);

  p.appendChild(item("Neuer Tab", "Strg+T", () => { veil.createTab(); close(); }));
  p.appendChild(item("Neu laden", "Strg+R", () => { veil.reload(); close(); }));
  p.appendChild(sep());

  // Zoom control row
  const zoom = h(`<div class="flex items-center justify-between px-3 py-1.5">
    <span class="text-sm text-[#d6dae2]">Zoom</span>
    <div class="flex items-center gap-1">
      <button data-z="out" class="grid place-items-center h-7 w-7 rounded-md hover:bg-white/10 text-[#d6dae2]">−</button>
      <button data-z="reset" class="text-xs text-[#9aa0ad] px-1.5 hover:text-white">Reset</button>
      <button data-z="in" class="grid place-items-center h-7 w-7 rounded-md hover:bg-white/10 text-[#d6dae2]">+</button>
    </div></div>`);
  zoom.querySelectorAll<HTMLElement>("[data-z]").forEach((b) =>
    b.addEventListener("click", () => veil.zoom(b.dataset.z as "in" | "out" | "reset"))
  );
  p.appendChild(zoom);

  p.appendChild(item("Downloads", "Strg+J", () => { ctx = { ...ctx, kind: "downloads" }; render(); }));
  p.appendChild(item("Verlauf", "Strg+H", () => { veil.createTab("veil://history"); close(); }));
  p.appendChild(item("Lesezeichen", "", () => { veil.createTab("veil://history"); close(); }));
  p.appendChild(sep());
  p.appendChild(item("Seite übersetzen", "", () => { veil.translatePage(); close(); }));
  p.appendChild(item("Drucken", "Strg+P", () => { veil.print(); close(); }));
  p.appendChild(item("Vollbild", "F11", () => { veil.toggleFullscreen(); close(); }));
  p.appendChild(item("Browserdaten löschen", "", () => { veil.clearData(); close(); }));
  p.appendChild(item("Seitenleiste umschalten", "", () => { save({ sidebarCollapsed: !settings.sidebarCollapsed }); }));
  p.appendChild(sep());
  p.appendChild(item("Einstellungen", "Strg+,", () => { veil.createTab("veil://settings"); close(); }));
  p.appendChild(item("Statistik zurücksetzen", "", async () => { await veil.resetStats(); close(); }, true));
  p.appendChild(item("Veil beenden", "", () => { veil.quit(); }, true));
  return p;
}

// ---------- Downloads panel ----------
function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + " GB";
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}
function fmtSpeed(bytesPerSec: number): string {
  return fmtBytes(bytesPerSec) + "/s";
}
function fmtEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return Math.ceil(seconds) + " s";
  if (seconds < 3600) return Math.round(seconds / 60) + " min";
  return (seconds / 3600).toFixed(1) + " h";
}

function renderDownloads(): HTMLElement {
  const p = h(`<div class="glass rounded-xl2 shadow-glass w-96 overflow-hidden"></div>`);
  p.appendChild(h(`<div class="flex items-center justify-between px-5 pt-4 pb-3">
    <span class="text-sm font-semibold">Downloads</span>
    <button id="dl-clear" class="text-xs text-[#8b93a3] hover:text-white">Liste leeren</button></div>`));

  const listEl = h(`<div class="max-h-96 overflow-y-auto px-3 pb-3 space-y-1"></div>`);
  if (!downloads.length) {
    listEl.appendChild(h(`<div class="text-center text-xs text-[#6b7280] py-8">Noch keine Downloads.</div>`));
  }
  for (const d of downloads) {
    const pct = d.total > 0 ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
    const done = d.state === "completed";
    const failed = d.state === "cancelled" || d.state === "interrupted";
    const active = !done && !failed;
    // Live line: "3.4 MB / 50 MB · 5.1 MB/s · 9 s übrig" (or "pausiert").
    let live: string;
    if (done) live = fmtBytes(d.received) + " · fertig";
    else if (failed) live = "abgebrochen";
    else if (d.paused) live = `${fmtBytes(d.received)}${d.total ? " / " + fmtBytes(d.total) : ""} · pausiert`;
    else {
      const eta = d.speed > 0 && d.total > d.received ? fmtEta((d.total - d.received) / d.speed) : "";
      const parts = [`${fmtBytes(d.received)}${d.total ? " / " + fmtBytes(d.total) : ""}`];
      if (d.speed > 0) parts.push(fmtSpeed(d.speed));
      if (eta) parts.push(eta + " übrig");
      live = parts.join(" · ");
    }
    const iconBtn = (attr: string, id: string, title: string, svg: string, color = "#9aa0ad") =>
      `<button ${attr}="${id}" title="${title}" class="grid place-items-center h-7 w-7 rounded-md hover:bg-white/10" style="color:${color}">${svg}</button>`;
    const pausePlay = d.paused
      ? iconBtn("data-resume", d.id, "Fortsetzen", `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`)
      : iconBtn("data-pause", d.id, "Pausieren", `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`);
    const stopBtn = iconBtn("data-cancel", d.id, "Stoppen", `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`, "#ff8b9e");
    const row = h(`<div class="px-2 py-2 rounded-lg hover:bg-white/5">
      <div class="flex items-center gap-3">
        <span class="grid place-items-center h-9 w-9 rounded-lg shrink-0" style="background:${done ? "rgba(51,214,196,0.14)" : "var(--veil-accent-soft)"};color:${done ? "#33d6c4" : failed ? "#ff8b9e" : "var(--veil-accent)"}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-sm truncate">${escapeHtml(d.filename)}</div>
          <div class="text-[11px] text-[#8b93a3] truncate">${live}</div>
        </div>
        ${done ? `<button data-open="${d.id}" class="text-xs px-2 py-1 rounded-md glass-hover glass">Öffnen</button>
                  <button data-show="${d.id}" class="text-xs px-2 py-1 rounded-md text-[#9aa0ad] hover:text-white">Ordner</button>` : ""}
        ${active ? `<div class="flex items-center gap-1 shrink-0">${pausePlay}${stopBtn}</div>` : ""}
      </div>
      ${active ? `<div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden"><div class="h-full rounded-full transition-all" style="width:${pct}%;background:${d.paused ? "#6b7280" : "var(--veil-accent)"}"></div></div>` : ""}
    </div>`);
    listEl.appendChild(row);
  }
  p.appendChild(listEl);

  p.querySelector<HTMLElement>("#dl-clear")!.addEventListener("click", async () => { await veil.clearDownloads(); });
  p.querySelectorAll<HTMLElement>("[data-open]").forEach((b) => b.addEventListener("click", () => veil.openDownload(b.dataset.open!)));
  p.querySelectorAll<HTMLElement>("[data-show]").forEach((b) => b.addEventListener("click", () => veil.showDownload(b.dataset.show!)));
  p.querySelectorAll<HTMLElement>("[data-cancel]").forEach((b) => b.addEventListener("click", () => veil.cancelDownload(b.dataset.cancel!)));
  p.querySelectorAll<HTMLElement>("[data-pause]").forEach((b) => b.addEventListener("click", () => veil.pauseDownload(b.dataset.pause!)));
  p.querySelectorAll<HTMLElement>("[data-resume]").forEach((b) => b.addEventListener("click", () => veil.resumeDownload(b.dataset.resume!)));
  return p;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

// ---------- Actions ----------
async function save(patch: Partial<Settings>) {
  settings = await veil.setSettings(patch);
  render();
}

async function togglePause() {
  if (!ctx.domain) return;
  const list = new Set(settings.allowlist);
  const pausing = !list.has(ctx.domain);
  if (pausing) list.add(ctx.domain);
  else list.delete(ctx.domain);
  settings = await veil.setSettings({ allowlist: [...list] });

  // Small confirmation animation before the panel closes.
  render();
  const shield = document.querySelector<HTMLElement>("#shield-icon");
  shield?.classList.add(pausing ? "shield-off" : "shield-on");
  await new Promise((r) => setTimeout(r, 380));
  veil.reload(); // apply new shield state to the page
  close();
}

function render() {
  // Leaving omni mode: restore the dimmed scrim + panel.
  omniActive = false;
  $("omni").classList.add("hidden");
  $("panel").classList.remove("hidden");
  $("scrim").style.background = "";
  const panel = $("panel");
  panel.innerHTML = "";
  if (ctx.kind === "update") {
    // Centered modal.
    panel.style.right = "";
    panel.style.left = "50%";
    panel.style.top = "50%";
    panel.style.transform = "translate(-50%, -50%)";
    renderUpdate(panel);
    return;
  }
  panel.style.left = "";
  panel.style.transform = "";
  panel.style.top = "92px";
  panel.style.right = `${ctx.anchorRight}px`;
  const view =
    ctx.kind === "shields" ? renderShields() :
    ctx.kind === "downloads" ? renderDownloads() :
    renderMenu();
  panel.appendChild(view);
}

const upIcon = `<div class="mx-auto mb-4 grid place-items-center h-14 w-14 rounded-2xl" style="background:var(--veil-accent-soft);color:var(--veil-accent)">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14"/></svg></div>`;

async function renderUpdate(panel: HTMLElement) {
  // On first open, resolve the info + whether an update is already staged.
  if (!up.info) {
    up.info = await veil.getUpdate();
    const staged = await veil.getStagedUpdate();
    if (staged && (!up.info || staged.version === up.info.version)) up.state = "ready";
  }
  const info = up.info;
  const ver = info ? escapeHtml(info.version) : "";
  const card = h(`<div class="glass rounded-xl2 shadow-glass w-96 p-6 text-center animate-pop"></div>`);

  if (up.state === "downloading") {
    const p = up.progress;
    const pct = p ? p.percent : 0;
    const line =
      p && p.phase === "extracting"
        ? "Entpacke …"
        : p
        ? `${fmtBytes(p.received)}${p.total ? " / " + fmtBytes(p.total) : ""}${p.speed ? " · " + fmtSpeed(p.speed) : ""}`
        : "Starte Download …";
    card.innerHTML = `${upIcon}
      <div class="text-lg font-semibold mb-1">Lädt Update ${ver}</div>
      <div class="text-sm text-[#8b93a3] mb-4">${line}</div>
      <div class="h-1.5 rounded-full bg-white/10 overflow-hidden mb-1"><div class="h-full rounded-full transition-all" style="width:${pct}%;background:var(--veil-accent)"></div></div>
      <div class="text-xs text-[#6b7280]">${pct}%</div>`;
    panel.appendChild(card);
    return;
  }

  if (up.state === "ready") {
    card.innerHTML = `${upIcon}
      <div class="text-lg font-semibold mb-1">Update bereit 🎉</div>
      <p class="text-sm text-[#8b93a3] mb-5 leading-relaxed">Version ${ver} ist heruntergeladen. Veil startet kurz neu, um sie zu übernehmen.</p>
      <div class="flex gap-2">
        <button id="up-later" class="flex-1 glass glass-hover text-sm py-2.5 rounded-lg">Später</button>
        <button id="up-restart" class="flex-1 text-sm py-2.5 rounded-lg font-medium" style="background:var(--veil-accent);color:#fff">Jetzt neu starten</button>
      </div>`;
    card.querySelector("#up-later")!.addEventListener("click", close);
    card.querySelector("#up-restart")!.addEventListener("click", () => veil.applyUpdate());
    panel.appendChild(card);
    return;
  }

  if (up.state === "error") {
    card.innerHTML = `${upIcon}
      <div class="text-lg font-semibold mb-1">Update fehlgeschlagen</div>
      <p class="text-sm text-[#8b93a3] mb-5 leading-relaxed">${escapeHtml(up.error || "Bitte später erneut versuchen.")}</p>
      <div class="flex gap-2">
        <button id="up-later" class="flex-1 glass glass-hover text-sm py-2.5 rounded-lg">Schließen</button>
        <button id="up-get" class="flex-1 text-sm py-2.5 rounded-lg font-medium" style="background:var(--veil-accent);color:#fff">Erneut versuchen</button>
      </div>`;
    card.querySelector("#up-later")!.addEventListener("click", close);
    card.querySelector("#up-get")!.addEventListener("click", startUpdateDownload);
    panel.appendChild(card);
    return;
  }

  // state === "available"
  const isMac = veil.platform === "darwin";
  const primaryLabel = isMac ? "Auf Website laden" : "Herunterladen";
  card.innerHTML = `${upIcon}
    <div class="text-lg font-semibold mb-1">Neues Update ${ver}</div>
    <div class="text-sm text-[#9aa0ad] mb-1">Version ${ver} ist da.</div>
    <p class="text-sm text-[#8b93a3] mb-5 leading-relaxed">${info && info.notes ? escapeHtml(info.notes) : "Neue Verbesserungen & Fehlerbehebungen."}</p>
    ${isMac ? `<p class="text-xs text-[#6b7280] mb-4">Unter macOS wird das Update manuell heruntergeladen.</p>` : ""}
    <div class="flex gap-2">
      <button id="up-later" class="flex-1 glass glass-hover text-sm py-2.5 rounded-lg">Später</button>
      <button id="up-get" class="flex-1 text-sm py-2.5 rounded-lg font-medium" style="background:var(--veil-accent);color:#fff">${primaryLabel}</button>
    </div>`;
  card.querySelector("#up-later")!.addEventListener("click", close);
  card.querySelector("#up-get")!.addEventListener("click", () => {
    if (isMac) {
      veil.createTab(info?.url || "https://welias123.github.io/veil-website/");
      close();
      return;
    }
    startUpdateDownload();
  });
  panel.appendChild(card);
}

function startUpdateDownload() {
  up.state = "downloading";
  up.progress = null;
  up.error = "";
  render();
  veil.downloadUpdate().catch((e: any) => {
    up.state = "error";
    up.error = (e && e.message) || "Download fehlgeschlagen";
    if (ctx?.kind === "update") render();
  });
}

// ---------- Omnibox suggestion list ----------
let omniActive = false;
function omniHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
function renderOmni(items: OmniItem[], sel: number) {
  const omni = $("omni");
  const inner = $("omniInner");
  if (!items.length) { omni.classList.add("hidden"); omniActive = false; return; }
  omniActive = true;
  $("panel").classList.add("hidden");
  $("scrim").style.background = "transparent"; // overlay the page without dimming
  omni.classList.remove("hidden");
  inner.innerHTML = "";
  const searchSvg =
    '<svg class="text-[#6b7280] shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
  items.forEach((it, i) => {
    const row = document.createElement("button");
    row.className =
      "w-full flex items-center gap-3 px-4 py-2 text-left text-sm " + (i === sel ? "bg-white/10" : "hover:bg-white/5");
    const icon = it.fav
      ? `<img src="https://icons.duckduckgo.com/ip3/${omniHost(it.value)}.ico" class="h-4 w-4 rounded shrink-0" />`
      : searchSvg;
    row.innerHTML = `${icon}<span class="truncate flex-1 text-[#e7e9ef]">${escapeHtml(it.title)}</span><span class="text-xs text-[#6b7280] truncate max-w-[42%]">${escapeHtml(it.sub)}</span>`;
    const img = row.querySelector("img");
    if (img) img.addEventListener("error", () => img.remove());
    row.addEventListener("mousedown", (e) => { e.preventDefault(); veil.omniPick(it.value); });
    inner.appendChild(row);
  });
}

// ---------- Boot ----------
async function init() {
  settings = await veil.getSettings();
  document.documentElement.classList.toggle("theme-light", settings.theme === "light");
  stats = await veil.getStats();
  downloads = await veil.getDownloads();
  $("scrim").addEventListener("click", () => (omniActive ? veil.omniPick("") : close()));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") { omniActive ? veil.omniPick("") : close(); } });
  veil.onStats((s) => { stats = s; if (ctx?.kind === "shields") render(); });
  veil.onDownloads((list) => { downloads = list; if (ctx?.kind === "downloads") render(); });
  veil.onUpdateProgress((p) => {
    up.progress = p;
    if (p.phase === "ready") up.state = "ready";
    else if (p.phase === "error") { up.state = "error"; up.error = p.error || "Fehler"; }
    else up.state = "downloading";
    if (ctx?.kind === "update") render();
  });
  veil.onOmniData(({ items, sel }) => renderOmni(items, sel));
  veil.onOverlayShow((next) => {
    ctx = next;
    render();
  });
}
init();
