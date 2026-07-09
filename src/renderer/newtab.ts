import { HistoryEntry, Settings, Stats } from "../shared/types";

interface Veil {
  getSettings(): Promise<Settings>;
  getStats(): Promise<Stats>;
  onStats(cb: (s: Stats) => void): void;
  onSettings(cb: (s: Settings) => void): void;
  getHistory(): Promise<HistoryEntry[]>;
}
const veil = (window as any).veil as Veil;
const $ = (id: string) => document.getElementById(id)!;

let settings: Settings;

// Estimated wall-clock time each blocked resource would have cost (page render
// + network). Mirrors the heuristic privacy browsers use for "time saved".
const MS_PER_BLOCK = 50;

// ---------- Clock ----------
function tickClock() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const h = now.getHours();
  const part = h < 5 ? "Gute Nacht" : h < 12 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  $("greeting").textContent = `${part} · ${now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}`;
}

// ---------- Formatting ----------
function formatBytes(bytes: number): { value: string; unit: string } {
  if (bytes >= 1024 ** 3) return { value: (bytes / 1024 ** 3).toFixed(2), unit: "GB" };
  if (bytes >= 1024 ** 2) return { value: (bytes / 1024 ** 2).toFixed(1), unit: "MB" };
  if (bytes >= 1024) return { value: (bytes / 1024).toFixed(0), unit: "KB" };
  return { value: String(bytes), unit: "B" };
}
function formatTime(ms: number): { value: string; unit: string } {
  const min = ms / 60000;
  if (min >= 60) return { value: (min / 60).toFixed(1), unit: "Std" };
  if (min >= 1) return { value: min.toFixed(0), unit: "Min" };
  return { value: (ms / 1000).toFixed(0), unit: "Sek" };
}
function formatCount(n: number): string {
  return n.toLocaleString("de-DE");
}

// ---------- Animated counters ----------
function animateNumber(el: HTMLElement, to: number, render: (v: number) => string, ms = 700) {
  const from = parseFloat(el.dataset.raw ?? "0") || 0;
  if (from === to) {
    el.textContent = render(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    el.textContent = render(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.dataset.raw = String(to);
  };
  requestAnimationFrame(step);
}

function renderStats(stats: Stats) {
  const blocked = stats.requestsBlocked;
  animateNumber($("blockedValue"), blocked, (v) => formatCount(Math.round(v)));

  const bw = formatBytes(stats.bytesSaved);
  $("bwUnit").textContent = bw.unit;
  animateNumber($("bwValue"), parseFloat(bw.value), (v) =>
    bw.unit === "GB" ? v.toFixed(2) : bw.unit === "MB" ? v.toFixed(1) : String(Math.round(v))
  );

  const t = formatTime(blocked * MS_PER_BLOCK);
  $("timeUnit").textContent = t.unit;
  animateNumber($("timeValue"), parseFloat(t.value), (v) =>
    t.unit === "Std" ? v.toFixed(1) : String(Math.round(v))
  );
}

// ---------- Search ----------
function resolveQuery(input: string): string {
  const raw = input.trim();
  if (/^[a-z]+:\/\//i.test(raw)) return raw;
  if (/^[^\s]+\.[^\s]+$/.test(raw)) return (raw.endsWith(".onion") ? "http://" : "https://") + raw;
  // Search with Veil's own engine.
  return `veil://search?q=${encodeURIComponent(raw)}`;
}

// ---------- Top-site tiles (from history, aggregated by host) ----------
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function labelFor(host: string): string {
  const core = host.split(".").slice(0, -1).join(".") || host;
  return core.charAt(0).toUpperCase() + core.slice(1);
}
async function renderTopSites() {
  const el = document.getElementById("tiles");
  if (!el) return;
  let hist: HistoryEntry[] = [];
  try { hist = await veil.getHistory(); } catch { return; }

  // Count visits per host, ignoring internal pages; keep the shortest URL seen.
  const map = new Map<string, { count: number; url: string }>();
  for (const h of hist) {
    if (!/^https?:/i.test(h.url)) continue;
    const host = hostOf(h.url);
    if (!host) continue;
    const cur = map.get(host);
    if (cur) cur.count++;
    else map.set(host, { count: 1, url: `https://${host}/` });
  }
  const top = [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  if (!top.length) return;

  el.innerHTML = "";
  for (const [host, info] of top) {
    const tile = document.createElement("div");
    tile.className = "tile";
    const initial = host.charAt(0).toUpperCase();
    tile.innerHTML =
      `<span class="ic"><img src="https://icons.duckduckgo.com/ip3/${host}.ico" alt="" /></span>` +
      `<span class="lbl">${labelFor(host)}</span>`;
    const img = tile.querySelector("img")!;
    img.addEventListener("error", () => {
      const ic = tile.querySelector(".ic") as HTMLElement;
      ic.textContent = initial;
      ic.style.background = "var(--veil-accent-soft)";
      ic.style.color = "var(--veil-accent)";
    });
    tile.addEventListener("click", () => { window.location.href = info.url; });
    el.appendChild(tile);
  }
}

async function init() {
  tickClock();
  setInterval(tickClock, 15_000);
  renderTopSites();

  settings = await veil.getSettings();
  document.documentElement.classList.toggle("theme-light", settings.theme === "light");
  $("shieldState").textContent = settings.shieldLevel === "off" ? "Shields aus" : "Shields aktiv";

  renderStats(await veil.getStats());
  veil.onStats(renderStats);
  veil.onSettings((s) => {
    settings = s;
    document.documentElement.classList.toggle("theme-light", s.theme === "light");
    $("shieldState").textContent = s.shieldLevel === "off" ? "Shields aus" : "Shields aktiv";
  });

  const search = $("search") as HTMLInputElement;
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && search.value.trim()) {
      window.location.href = resolveQuery(search.value);
    }
  });
  search.focus();
}

init();
