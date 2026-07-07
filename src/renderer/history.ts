import { HistoryEntry } from "../shared/types";

interface Veil {
  getHistory(): Promise<HistoryEntry[]>;
  deleteHistory(urls: string[]): Promise<void>;
  clearHistory(): Promise<void>;
  onHistory(cb: (list: HistoryEntry[]) => void): void;
  getSettings(): Promise<{ theme: "dark" | "light" }>;
  onSettings(cb: (s: { theme: "dark" | "light" }) => void): void;
}
const veil = (window as any).veil as Veil;
const $ = (id: string) => document.getElementById(id)!;

let entries: HistoryEntry[] = [];
const selected = new Set<string>();
let filter = "";

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Heute";
  if (d.toDateString() === yest.toDateString()) return "Gestern";
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

function render() {
  const host = $("list");
  host.innerHTML = "";
  const q = filter.toLowerCase();
  const list = entries.filter((e) => !q || e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q));
  $("empty").classList.toggle("hidden", list.length > 0);
  ($("delSel") as HTMLElement).classList.toggle("hidden", selected.size === 0);

  let lastDay = "";
  for (const e of list) {
    const day = dayLabel(e.time);
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement("div");
      h.className = "text-xs font-semibold text-[#7b8291] mt-6 mb-2 px-2";
      h.textContent = day;
      host.appendChild(h);
    }
    const row = document.createElement("div");
    row.className = "group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5";
    const time = new Date(e.time).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    row.innerHTML = `
      <input type="checkbox" ${selected.has(e.url) ? "checked" : ""} class="accent-[var(--veil-accent)] shrink-0" />
      <img src="https://icons.duckduckgo.com/ip3/${hostOf(e.url)}.ico" alt="" class="h-4 w-4 rounded shrink-0" data-fav />
      <button class="flex-1 min-w-0 text-left">
        <div class="text-sm truncate text-[#e7e9ef] group-hover:text-white">${escapeHtml(e.title)}</div>
        <div class="text-xs text-[#7b8291] truncate">${escapeHtml(e.url)}</div>
      </button>
      <span class="text-xs text-[#5b6473] shrink-0">${time}</span>
      <button data-del class="opacity-0 group-hover:opacity-100 icon-btn h-7 w-7 text-[#ff8b9e]" title="Löschen">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>`;
    const cb = row.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.addEventListener("change", () => {
      cb.checked ? selected.add(e.url) : selected.delete(e.url);
      ($("delSel") as HTMLElement).classList.toggle("hidden", selected.size === 0);
    });
    row.querySelector<HTMLImageElement>("img")!.addEventListener("error", (ev) => (ev.target as HTMLElement).remove());
    row.querySelector("button")!.addEventListener("click", () => (location.href = e.url));
    row.querySelector("[data-del]")!.addEventListener("click", () => veil.deleteHistory([e.url]));
    host.appendChild(row);
  }
}

async function init() {
  const applyTheme = (t: string) => document.documentElement.classList.toggle("theme-light", t === "light");
  veil.getSettings().then((s) => applyTheme(s.theme));
  veil.onSettings((s) => applyTheme(s.theme));
  entries = await veil.getHistory();
  render();
  veil.onHistory((list) => { entries = list; render(); });
  ($("filter") as HTMLInputElement).addEventListener("input", (e) => {
    filter = (e.target as HTMLInputElement).value;
    render();
  });
  $("clear").addEventListener("click", () => { if (confirm("Gesamten Verlauf löschen?")) veil.clearHistory(); });
  $("delSel").addEventListener("click", () => { veil.deleteHistory([...selected]); selected.clear(); });
}
init();
