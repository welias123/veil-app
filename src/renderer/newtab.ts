import { Settings, Stats } from "../shared/types";

interface Veil {
  getSettings(): Promise<Settings>;
  getStats(): Promise<Stats>;
  onStats(cb: (s: Stats) => void): void;
  onSettings(cb: (s: Settings) => void): void;
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

async function init() {
  tickClock();
  setInterval(tickClock, 15_000);

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
