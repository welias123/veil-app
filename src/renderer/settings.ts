import { Settings, TorRuntimeStatus } from "../shared/types";

interface Veil {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  resetStats(): Promise<unknown>;
  torStatus(): Promise<TorRuntimeStatus>;
  onTorStatus(cb: (s: TorRuntimeStatus) => void): void;
  clearHistory(): Promise<void>;
  setDefaultBrowser(): Promise<boolean>;
  isDefaultBrowser(): Promise<boolean>;
}
const veil = (window as any).veil as Veil;

let s: Settings;
let torState: TorRuntimeStatus = { enabled: false, reachable: false, phase: "off", progress: 0, message: "Tor deaktiviert" };

function h(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** The accent is fixed (Veil purple); only opacity/blur are user-tunable. */
function applyThemePreview(next: Settings) {
  document.documentElement.classList.toggle("theme-light", next.theme === "light");
  const root = document.documentElement.style;
  root.setProperty("--veil-bg-opacity", String(next.backgroundOpacity));
  root.setProperty("--veil-blur", `${next.blur}px`);
}

async function update(patch: Partial<Settings>) {
  s = await veil.setSettings(patch);
  applyThemePreview(s);
  if ("torEnabled" in patch || "torSocksPort" in patch) torState = await veil.torStatus();
}

/** Re-render while preserving scroll position so the page never jumps to top. */
function rerender() {
  const content = document.querySelector<HTMLElement>(".st-content");
  const y = content?.scrollTop ?? 0;
  render();
  if (content) content.scrollTop = y;
}

// ---------- Control builders ----------
function toggle(key: keyof Settings, label: string, desc = ""): HTMLElement {
  const on = s[key] as boolean;
  const row = h(`<div class="flex items-center justify-between py-3">
    <div class="pr-6"><div class="text-sm text-[#e7e9ef]">${label}</div>${desc ? `<div class="text-xs text-[#7b8291] mt-0.5">${desc}</div>` : ""}</div>
    <button class="relative h-6 w-11 rounded-full shrink-0 transition-colors ${on ? "" : "bg-white/10"}" style="${on ? "background:var(--veil-accent)" : ""}">
      <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style="left:${on ? "22px" : "2px"}"></span>
    </button></div>`);
  row.querySelector("button")!.addEventListener("click", () => {
    update({ [key]: !(s[key] as boolean) } as any).then(rerender);
  });
  return row;
}

function segmented(key: keyof Settings, options: [string, string][]): HTMLElement {
  const row = h(`<div class="grid gap-1 p-1 rounded-xl bg-black/30" style="grid-template-columns:repeat(${options.length},1fr)"></div>`);
  for (const [val, label] of options) {
    const active = s[key] === val;
    const b = h(`<button class="text-sm py-2 rounded-lg transition-colors ${active ? "text-white" : "text-[#9aa0ad] hover:text-white"}" style="${active ? "background:var(--veil-accent)" : ""}">${label}</button>`);
    b.addEventListener("click", () => update({ [key]: val } as any).then(rerender));
    row.appendChild(b);
  }
  return row;
}

function slider(key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement {
  const val = s[key] as number;
  const row = h(`<div class="flex items-center gap-4 py-3">
    <input type="range" min="${min}" max="${max}" step="${step}" value="${val}" class="flex-1 accent-[var(--veil-accent)]" />
    <span class="text-sm tabular-nums text-[#9aa0ad] w-16 text-right">${fmt(val)}</span></div>`);
  const input = row.querySelector("input")!;
  const out = row.querySelector("span")!;
  input.addEventListener("input", () => {
    out.textContent = fmt(parseFloat(input.value));
    applyThemePreview({ ...s, [key]: parseFloat(input.value) } as Settings);
  });
  input.addEventListener("change", () => update({ [key]: parseFloat(input.value) } as any));
  return row;
}

// Small inline icons for the category sidebar (Brave-style).
const ICONS: Record<string, string> = {
  allgemein: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V21H3z"/><path d="M9 21v-7h6v7"/></svg>`,
  design: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M12 21a4 4 0 0 0 0-8 3 3 0 0 1 0-6"/></svg>`,
  shields: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  tor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>`,
  suche: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
  ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-4.6 2.9L16 19l-4-3.6L8 19l1.1-6.1L4.5 10l5.6-1.4z"/></svg>`,
  daten: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  newtab: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M12 13v4M10 15h4"/></svg>`,
  downloads: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>`,
  inhalte: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 12h16M4 19h10"/></svg>`,
};

/** Numeric select row (e.g. zoom levels). */
function selectRowNum(key: keyof Settings, label: string, options: [number, string][], desc = ""): HTMLElement {
  const row = h(`<div class="flex items-center justify-between py-3 gap-4">
    <div class="pr-2"><div class="text-sm text-[#e7e9ef]">${label}</div>${desc ? `<div class="text-xs text-[#7b8291] mt-0.5">${desc}</div>` : ""}</div>
    <select class="glass rounded-lg px-3 py-1.5 text-sm outline-none accent-ring shrink-0" style="background:rgba(0,0,0,0.25)">
      ${options.map(([v, l]) => `<option value="${v}" ${s[key] === v ? "selected" : ""}>${l}</option>`).join("")}
    </select></div>`);
  row.querySelector("select")!.addEventListener("change", (e) => {
    update({ [key]: parseFloat((e.target as HTMLSelectElement).value) } as any).then(rerender);
  });
  return row;
}

/** Native select row (for choices with many options, e.g. search engines). */
function selectRow(key: keyof Settings, label: string, options: [string, string][], desc = ""): HTMLElement {
  const row = h(`<div class="flex items-center justify-between py-3 gap-4">
    <div class="pr-2"><div class="text-sm text-[#e7e9ef]">${label}</div>${desc ? `<div class="text-xs text-[#7b8291] mt-0.5">${desc}</div>` : ""}</div>
    <select class="glass rounded-lg px-3 py-1.5 text-sm outline-none accent-ring shrink-0" style="background:rgba(0,0,0,0.25)">
      ${options.map(([v, l]) => `<option value="${v}" ${s[key] === v ? "selected" : ""}>${l}</option>`).join("")}
    </select></div>`);
  row.querySelector("select")!.addEventListener("change", (e) => {
    update({ [key]: (e.target as HTMLSelectElement).value } as any).then(rerender);
  });
  return row;
}

// Section registry for building the sidebar nav in render order.
let NAV: { id: string; icon: string; title: string }[] = [];

function section(id: string, title: string, desc: string, ...children: HTMLElement[]): HTMLElement {
  NAV.push({ id, icon: ICONS[id] || "", title });
  const c = h(`<section class="st-section" id="sec-${id}" data-title="${title}">
    <div class="st-sec-head">${ICONS[id] || ""}<div><h2>${title}</h2><p>${desc}</p></div></div>
    <div class="st-panel"></div></section>`);
  const body = c.querySelector(".st-panel")!;
  children.forEach((ch) => { ch.classList.add("st-row"); body.appendChild(ch); });
  return c;
}

// ---------- Sections ----------
function render() {
  const host = document.getElementById("sections")!;
  host.innerHTML = "";
  NAV = [];

  // Default browser
  const defRow = h(`<div class="flex items-center justify-between py-3">
    <div><div class="text-sm">Veil als Standardbrowser</div><div id="def-state" class="text-xs text-[#7b8291] mt-0.5">Links öffnen sich dann automatisch in Veil.</div></div>
    <button id="def-btn" class="glass glass-hover text-sm px-4 py-2 rounded-lg">Festlegen</button></div>`);
  const defBtn = defRow.querySelector<HTMLButtonElement>("#def-btn")!;
  const defState = defRow.querySelector<HTMLElement>("#def-state")!;
  veil.isDefaultBrowser().then((is) => {
    if (is) { defBtn.textContent = "Standard ✓"; defBtn.disabled = true; defState.textContent = "Veil ist dein Standardbrowser."; }
  });
  defBtn.addEventListener("click", async () => {
    await veil.setDefaultBrowser();
    defState.textContent = "Wenn Windows fragt, wähle bitte Veil aus.";
    setTimeout(async () => { if (await veil.isDefaultBrowser()) { defBtn.textContent = "Standard ✓"; defBtn.disabled = true; } }, 1500);
  });
  host.appendChild(section("allgemein", "Allgemein", "Grundeinstellungen für Veil.", defRow));

  // Privacy
  const level = h(`<div class="py-3"><div class="text-sm mb-2">Shield-Stufe</div></div>`);
  level.appendChild(segmented("shieldLevel", [["aggressive", "Aggressiv"], ["standard", "Standard"], ["off", "Aus"]]));
  host.appendChild(
    section("shields", "Privatsphäre & Shields", "Blockiere Werbung, Tracker und Fingerprinting.",
      level,
      toggle("blockScripts", "Skript-Blocker", "Blockiert Drittanbieter-Skripte (kann Seiten beeinträchtigen)."),
      toggle("fingerprintProtection", "Schutz vor Fingerprinting", "Randomisiert Canvas & reduziert Geräte-Entropie."),
      toggle("httpsEverywhere", "HTTPS erzwingen", "Verbindungen automatisch auf HTTPS upgraden."),
      toggle("blockCookieBanners", "Cookie-Banner blockieren", "Banner automatisch schließen/ablehnen."),
      toggle("doNotTrack", "„Nicht verfolgen\"-Anfrage senden", "Sendet DNT- & GPC-Header an alle Websites."),
      toggle("blockPopups", "Pop-ups blockieren", "Verhindert, dass Seiten neue Fenster/Tabs aufzwingen."),
      toggle("clearCookiesOnExit", "Cookies beim Beenden löschen", "Meldet dich bei jedem Neustart überall ab.")
    )
  );

  // Tor (uses cached status; live-updated via onTorStatus below)
  const ready = torState.reachable || torState.phase === "ready";
  const busy = torState.phase === "downloading" || torState.phase === "starting" || torState.phase === "bootstrapping";
  const dot = !torState.enabled ? "bg-white/20" : ready ? "bg-green-400" : torState.phase === "error" ? "bg-red-400" : "bg-amber-400";
  const label = !torState.enabled
    ? "Tor deaktiviert"
    : ready
    ? "Tor-Netzwerk verbunden ✓"
    : torState.message;
  const status = h(`<div class="py-2">
    <div class="flex items-center gap-2 text-xs">
      <span class="h-2 w-2 rounded-full ${dot} ${busy ? "animate-pulse" : ""}"></span>
      <span class="text-[#9aa0ad]">${label}</span>
    </div>
    ${busy ? `<div class="mt-2 h-1 rounded-full bg-white/10 overflow-hidden"><div class="h-full rounded-full transition-all" style="width:${torState.progress}%;background:var(--veil-accent)"></div></div>` : ""}
  </div>`);
  const port = h(`<div class="flex items-center justify-between py-3">
    <div class="text-sm">SOCKS-Port</div>
    <input type="number" value="${s.torSocksPort}" class="glass rounded-lg px-3 py-1.5 w-24 text-sm text-right outline-none accent-ring" /></div>`);
  port.querySelector("input")!.addEventListener("change", (e) => {
    update({ torSocksPort: parseInt((e.target as HTMLInputElement).value) || 9050 }).then(rerender);
  });
  host.appendChild(
    section("tor", "Tor-Routing", ".onion-Adressen nativ über das Tor-Netzwerk auflösen. Benötigt einen laufenden Tor-Daemon.",
      status,
      toggle("torEnabled", "Tor aktivieren", "Routet .onion-Domains über SOCKS5."),
      toggle("routeAllThroughTor", "Gesamten Traffic über Tor", "Auch Clearnet-Seiten über Tor leiten (langsamer)."),
      port
    )
  );

  // Search — built-in Veil search, or a chosen external engine.
  host.appendChild(
    section("suche", "Suche", "Wähle, womit Veil aus der Adressleiste sucht.",
      toggle("useVeilSearch", "Eigene Veil-Suche verwenden", "Werbefrei & integriert, keine Weiterleitung. Aus = externe Suchmaschine unten."),
      selectRow("searchEngine", "Externe Suchmaschine", [
        ["duckduckgo", "DuckDuckGo"], ["brave", "Brave Search"], ["startpage", "Startpage"],
        ["google", "Google"], ["ecosia", "Ecosia"],
      ], "Wird genutzt, wenn die Veil-Suche aus ist.")
    )
  );

  // Veil AI is free and always on — no configuration needed.
  const aiInfo = h(`<div class="flex items-center gap-3 py-3">
    <span class="grid place-items-center h-9 w-9 rounded-lg shrink-0" style="background:var(--veil-accent-soft);color:var(--veil-accent)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-4.6 2.9L16 19l-4-3.6L8 19l1.1-6.1L4.5 10l5.6-1.4z"/></svg>
    </span>
    <div><div class="text-sm">Veil AI ist aktiv</div><div class="text-xs text-[#7b8291] mt-0.5">Kostenlose KI-Antworten & Chat direkt in der Suche — für jeden, ohne Einrichtung.</div></div></div>`);
  host.appendChild(section("ai", "Veil AI", "Antworten auf Fragen direkt in der Suche.", aiInfo));

  // Content behaviour
  host.appendChild(
    section("inhalte", "Inhalte", "Wie Seiten sich verhalten.",
      toggle("blockAutoplay", "Autoplay blockieren", "Videos & Audio starten nicht von selbst (gilt für neue Tabs)."),
      selectRowNum("defaultZoom", "Standard-Zoom", [
        [0.8, "80 %"], [0.9, "90 %"], [1, "100 %"], [1.1, "110 %"], [1.25, "125 %"], [1.5, "150 %"],
      ], "Zoomstufe für neu geöffnete Seiten."),
      selectRow("translateTarget", "Übersetzen nach", [
        ["de", "Deutsch"], ["en", "Englisch"], ["es", "Spanisch"], ["fr", "Französisch"],
        ["it", "Italienisch"], ["tr", "Türkisch"], ["ru", "Russisch"], ["pl", "Polnisch"],
      ], "Zielsprache für „Seite übersetzen\".")
    )
  );

  // Appearance — theme (dark/light) switch; accent stays FIXED (Veil purple).
  const themeRow = h(`<div class="py-3"><div class="text-sm mb-2">Erscheinungsbild</div></div>`);
  themeRow.appendChild(segmented("theme", [["dark", "Dunkel"], ["light", "Hell"]]));
  const fixed = h(`<div class="flex items-center justify-between py-3">
    <div><div class="text-sm">Akzentfarbe</div><div class="text-xs text-[#7b8291] mt-0.5">Fest — das Veil-Lila.</div></div>
    <span class="h-7 w-7 rounded-full ring-2 ring-white/15" style="background:var(--veil-accent)"></span></div>`);
  const opacity = h(`<div class="py-3"><div class="text-sm mb-1">Hintergrund-Deckkraft</div></div>`);
  opacity.appendChild(slider("backgroundOpacity", 0.3, 1, 0.02, (v) => `${Math.round(v * 100)}%`));
  const blur = h(`<div class="py-3"><div class="text-sm mb-1">Blur-Filter</div></div>`);
  blur.appendChild(slider("blur", 0, 40, 1, (v) => `${Math.round(v)}px`));
  host.appendChild(section("design", "Design", "Hell oder dunkel, Lila bleibt die Akzentfarbe.", themeRow, fixed, opacity, blur));

  // New-tab page
  host.appendChild(
    section("newtab", "Neuer Tab", "Was auf der Neuer-Tab-Seite angezeigt wird.",
      toggle("newtabShowClock", "Uhr & Begrüßung", "Zeigt oben die Uhrzeit und einen Gruß."),
      toggle("newtabShowTopSites", "Lieblingsseiten-Kacheln", "Meistbesuchte Seiten als Kacheln aus dem Verlauf."),
      toggle("newtabShowStats", "Statistik-Karte", "Blockierte Tracker, gesparte Bandbreite & Zeit.")
    )
  );

  // Downloads
  const dlFolder = h(`<div class="flex items-center gap-3 py-3">
    <span class="grid place-items-center h-9 w-9 rounded-lg shrink-0" style="background:var(--veil-accent-soft);color:var(--veil-accent)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M4 4v12l4-3h12V4z"/></svg>
    </span>
    <div><div class="text-sm">Speicherort</div><div class="text-xs text-[#7b8291] mt-0.5">Standardmäßig dein „Downloads\"-Ordner.</div></div></div>`);
  host.appendChild(
    section("downloads", "Downloads", "Wie Veil Dateien speichert.",
      toggle("askDownloadLocation", "Vor jedem Download nach Speicherort fragen", "Zeigt einen Dialog, statt automatisch zu speichern."),
      dlFolder
    )
  );

  // Layout & data
  const openHist = h(`<div class="flex items-center justify-between py-3"><div><div class="text-sm">Verlauf</div>
    <div class="text-xs text-[#7b8291] mt-0.5">Besuchte Seiten ansehen, durchsuchen und löschen.</div></div>
    <button class="glass glass-hover text-sm px-4 py-2 rounded-lg">Verlauf öffnen</button></div>`);
  openHist.querySelector("button")!.addEventListener("click", () => (location.href = "veil://history"));
  const clearHist = h(`<div class="flex items-center justify-between py-3"><div><div class="text-sm">Verlauf löschen</div>
    <div class="text-xs text-[#7b8291] mt-0.5">Entfernt den gesamten Browserverlauf.</div></div>
    <button class="glass glass-hover text-sm px-4 py-2 rounded-lg text-[#ff8b9e]">Löschen</button></div>`);
  clearHist.querySelector("button")!.addEventListener("click", () => {
    if (confirm("Gesamten Verlauf löschen?")) veil.clearHistory();
  });
  const reset = h(`<div class="flex items-center justify-between py-3"><div><div class="text-sm">Statistik zurücksetzen</div>
    <div class="text-xs text-[#7b8291] mt-0.5">Setzt alle Blockier-Zähler auf null.</div></div>
    <button class="glass glass-hover text-sm px-4 py-2 rounded-lg text-[#ff8b9e]">Zurücksetzen</button></div>`);
  reset.querySelector("button")!.addEventListener("click", () => veil.resetStats());
  host.appendChild(
    section("daten", "Verlauf & Daten", "Browserverlauf, Oberfläche und Statistiken.",
      toggle("saveHistory", "Verlauf aufzeichnen", "Wenn aus, merkt sich Veil keine besuchten Seiten."),
      openHist,
      clearHist,
      toggle("sidebarCollapsed", "Seitenleiste eingeklappt", "Blendet die linke Navigationsleiste aus."),
      reset
    )
  );

  buildNav();
  const q = (document.getElementById("st-search") as HTMLInputElement | null)?.value ?? "";
  if (q) applySearch(q);
}

// ---------- Sidebar nav + search ----------
function buildNav() {
  const nav = document.getElementById("st-nav")!;
  nav.innerHTML = "";
  for (const item of NAV) {
    const el = h(`<div class="st-nav-item" data-target="sec-${item.id}">${item.icon}<span>${item.title}</span></div>`);
    el.addEventListener("click", () => {
      document.getElementById(`sec-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    nav.appendChild(el);
  }
  updateActiveNav();
}

function updateActiveNav() {
  const content = document.querySelector<HTMLElement>(".st-content");
  if (!content) return;
  const y = content.scrollTop + 120;
  let currentId = NAV[0]?.id;
  for (const item of NAV) {
    const sec = document.getElementById(`sec-${item.id}`);
    if (sec && sec.offsetTop <= y) currentId = item.id;
  }
  document.querySelectorAll<HTMLElement>(".st-nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.target === `sec-${currentId}`);
  });
}

function applySearch(query: string) {
  const q = query.trim().toLowerCase();
  const empty = document.getElementById("st-empty")!;
  let anyVisible = false;
  document.querySelectorAll<HTMLElement>(".st-section").forEach((sec) => {
    const title = (sec.dataset.title || "").toLowerCase();
    let secVisible = false;
    sec.querySelectorAll<HTMLElement>(".st-row").forEach((row) => {
      const match = !q || title.includes(q) || row.textContent!.toLowerCase().includes(q);
      row.classList.toggle("hidden", !match);
      if (match) secVisible = true;
    });
    sec.style.display = secVisible ? "" : "none";
    if (secVisible) anyVisible = true;
  });
  document.querySelectorAll<HTMLElement>(".st-nav-item").forEach((el) => {
    const sec = document.getElementById(el.dataset.target!);
    el.style.display = sec && sec.style.display !== "none" ? "" : "none";
  });
  empty.hidden = anyVisible;
}

async function init() {
  s = await veil.getSettings();
  torState = await veil.torStatus();
  applyThemePreview(s);
  render();

  const search = document.getElementById("st-search") as HTMLInputElement;
  search.addEventListener("input", () => applySearch(search.value));
  document.querySelector(".st-content")!.addEventListener("scroll", updateActiveNav, { passive: true });

  // Live Tor progress (download → bootstrap → ready) without losing scroll.
  veil.onTorStatus((st) => {
    torState = st;
    rerender();
  });
}
init();
