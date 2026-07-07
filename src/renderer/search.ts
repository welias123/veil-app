import { AiMessage, AiReply, NewsResult, SearchKind, SearchResult, VideoResult } from "../shared/types";

interface Veil {
  search(q: string, kind?: SearchKind, offset?: number): Promise<SearchResult[] | VideoResult[] | NewsResult[]>;
  suggest(q: string): Promise<string[]>;
  aiChat(messages: AiMessage[]): Promise<AiReply>;
  getSettings(): Promise<{ theme: "dark" | "light" }>;
  onSettings(cb: (s: { theme: "dark" | "light" }) => void): void;
}
const veil = (window as any).veil as Veil;
const $ = (id: string) => document.getElementById(id)!;

type Tab = "ai" | "web" | "videos" | "news";
let offset = 0; // web pagination offset
let chat: AiMessage[] = []; // AI conversation for the current query
const TABS: [Tab, string][] = [
  ["ai", "Fragen"],
  ["web", "Alles"],
  ["videos", "Videos"],
  ["news", "Nachrichten"],
];

function isQuestion(q: string): boolean {
  return /\?\s*$/.test(q) || /^(was|wer|wie|wo|wann|warum|wieso|welche[rs]?|wozu|is[st]|kann|soll|darf|what|who|how|why|where|when|which|is|are|can|does|do)\b/i.test(q.trim());
}

let query = "";
let tab: Tab = "web";

// ---------- helpers ----------
function getQuery(): string {
  return new URLSearchParams(location.search).get("q") ?? "";
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return hostOf(url) + decodeURIComponent(p).replace(/\//g, " › ");
  } catch {
    return url;
  }
}
/** Privacy-friendly favicon via DuckDuckGo's icon proxy (letter fallback).
 *  No inline handlers (CSP-safe); wired up by wireImages() after insertion. */
function favicon(url: string): string {
  const host = hostOf(url);
  const letter = (host || "?").charAt(0).toUpperCase();
  return `<span class="relative grid place-items-center h-6 w-6 rounded-md overflow-hidden shrink-0" style="background:var(--veil-accent-soft)">
    <span class="text-[11px] font-bold" style="color:var(--veil-accent)">${letter}</span>
    <img data-fav src="https://icons.duckduckgo.com/ip3/${host}.ico" alt=""
      class="absolute inset-0 h-full w-full object-cover" style="opacity:0;transition:opacity .15s" />
  </span>`;
}
/** Attach CSP-safe load/error handlers to favicons and thumbnails.
 *  Handles the case where a (cached) image already finished loading before the
 *  listener was attached — otherwise the load event is missed and the favicon
 *  stays invisible ("favicons disappear after a while"). */
function wireImages(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>("img[data-fav]").forEach((img) => {
    const show = () => (img.style.opacity = "1");
    if (img.complete && img.naturalWidth > 0) show();
    else if (img.complete) img.remove(); // already errored
    else {
      img.addEventListener("load", show);
      img.addEventListener("error", () => img.remove());
    }
  });
  root.querySelectorAll<HTMLImageElement>("img[data-thumb]").forEach((img) => {
    if (img.complete && img.naturalWidth === 0) img.style.display = "none";
    else img.addEventListener("error", () => (img.style.display = "none"));
  });
}
function nav(url: string) {
  location.href = url;
}

// ---------- renderers ----------
function webCard(r: SearchResult): HTMLElement {
  const el = document.createElement("div");
  el.className = "group";
  el.innerHTML = `
    <div class="flex items-center gap-2.5 mb-1">
      ${favicon(r.url)}
      <span class="text-xs text-[#7b8291] truncate">${escapeHtml(prettyUrl(r.url))}</span>
    </div>
    <a href="${escapeHtml(r.url)}" class="block text-lg leading-snug text-[#8ab4ff] group-hover:underline">${escapeHtml(r.title)}</a>
    ${r.snippet ? `<p class="text-sm text-[#9aa0ad] mt-1 leading-relaxed">${escapeHtml(r.snippet)}</p>` : ""}`;
  el.querySelector("a")!.addEventListener("click", (e) => { e.preventDefault(); nav(r.url); });
  return el;
}

function videoCard(v: VideoResult): HTMLElement {
  const el = document.createElement("a");
  el.href = v.url;
  el.className = "group block glass rounded-xl overflow-hidden glass-hover";
  el.innerHTML = `
    <div class="relative aspect-video bg-black/40">
      ${v.thumbnail ? `<img data-thumb src="${escapeHtml(v.thumbnail)}" alt="" class="h-full w-full object-cover" />` : ""}
      ${v.duration ? `<span class="absolute bottom-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/80 text-white">${escapeHtml(v.duration)}</span>` : ""}
      <span class="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
      </span>
    </div>
    <div class="p-2.5">
      <div class="text-sm leading-snug line-clamp-2 text-[#e7e9ef] group-hover:text-white">${escapeHtml(v.title)}</div>
      <div class="text-[11px] text-[#7b8291] mt-1 truncate">${escapeHtml(v.publisher || hostOf(v.url))}</div>
    </div>`;
  el.addEventListener("click", (e) => { e.preventDefault(); nav(v.url); });
  return el;
}

function newsCard(n: NewsResult): HTMLElement {
  const el = document.createElement("div");
  el.className = "group";
  const when = n.date ? new Date(n.date * 1000).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" }) : "";
  el.innerHTML = `
    <div class="flex items-center gap-2.5 mb-1">
      ${favicon(n.url)}
      <span class="text-xs text-[#7b8291] truncate">${escapeHtml(n.source || hostOf(n.url))}${when ? " · " + when : ""}</span>
    </div>
    <a href="${escapeHtml(n.url)}" class="block text-base leading-snug text-[#8ab4ff] group-hover:underline">${escapeHtml(n.title)}</a>
    ${n.excerpt ? `<p class="text-sm text-[#9aa0ad] mt-1 leading-relaxed">${escapeHtml(n.excerpt)}</p>` : ""}`;
  el.querySelector("a")!.addEventListener("click", (e) => { e.preventDefault(); nav(n.url); });
  return el;
}

function videoSection(videos: VideoResult[], title = "Videos"): HTMLElement {
  const sec = document.createElement("div");
  sec.innerHTML = `<div class="flex items-center gap-2 mb-3 mt-2">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--veil-accent)" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 9l5 3-5 3z" fill="var(--veil-accent)"/></svg>
    <span class="text-sm font-semibold">${title}</span></div>`;
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-2 sm:grid-cols-3 gap-3";
  videos.forEach((v) => grid.appendChild(videoCard(v)));
  sec.appendChild(grid);
  return sec;
}

// ---------- tab bar ----------
function renderTabs() {
  const host = $("tabs");
  host.innerHTML = "";
  for (const [key, label] of TABS) {
    const active = key === tab;
    const b = document.createElement("button");
    b.className = `px-4 py-2.5 text-sm border-b-2 transition-colors ${
      active ? "text-white" : "text-[#8b93a3] border-transparent hover:text-white"
    }`;
    b.style.borderBottomColor = active ? "var(--veil-accent)" : "transparent";
    b.textContent = label;
    b.addEventListener("click", () => {
      if (tab !== key) { tab = key; offset = 0; renderTabs(); run(); }
    });
    host.appendChild(b);
  }
}

// ---------- run ----------
async function run() {
  const results = $("results");
  const empty = $("empty");
  results.innerHTML = "";
  empty.classList.add("hidden");
  $("meta").textContent = "Suche läuft…";

  if (tab === "ai") {
    await renderAi();
    return;
  }

  if (tab === "web") {
    const web = (await veil.search(query, "web", offset)) as SearchResult[];
    if (!web.length) return showEmpty();
    $("meta").textContent = offset
      ? `Seite ${Math.floor(offset / 20) + 1} · werbefrei über Veil`
      : `Ergebnisse · werbefrei über Veil`;
    const wrap = document.createElement("div");
    wrap.className = "space-y-6";
    // Auto AI answer at the top for question-like queries (first page only).
    if (offset === 0 && isQuestion(query)) wrap.appendChild(aiAnswerCard());
    // Render ALL web results immediately — never block them on the video fetch.
    web.forEach((r) => wrap.appendChild(webCard(r)));
    results.appendChild(wrap);
    wireImages(results);
    results.appendChild(await relatedAndPager());

    // Load the inline video carousel in the background and slot it in after the
    // first few results (like Brave), without blocking the web results.
    if (offset === 0) {
      const anchorIdx = (isQuestion(query) ? 1 : 0) + 4;
      veil.search(query, "videos").then((v) => {
        const videos = v as VideoResult[];
        if (!videos.length) return;
        const sec = videoSection(videos.slice(0, 6));
        const ref = wrap.children[anchorIdx] ?? null;
        wrap.insertBefore(sec, ref);
        wireImages(sec);
      }).catch(() => {});
    }
    return;
  } else if (tab === "videos") {
    const videos = (await veil.search(query, "videos")) as VideoResult[];
    if (!videos.length) return showEmpty();
    $("meta").textContent = `${videos.length} Videos · werbefrei über Veil`;
    const grid = document.createElement("div");
    grid.className = "grid grid-cols-2 sm:grid-cols-3 gap-4";
    videos.forEach((v) => grid.appendChild(videoCard(v)));
    results.appendChild(grid);
  } else {
    const news = (await veil.search(query, "news")) as NewsResult[];
    if (!news.length) return showEmpty();
    $("meta").textContent = `${news.length} Nachrichten · werbefrei über Veil`;
    const wrap = document.createElement("div");
    wrap.className = "space-y-6";
    news.forEach((n) => wrap.appendChild(newsCard(n)));
    results.appendChild(wrap);
  }
  wireImages(results);
}

// ---------- Veil AI ("Fragen") ----------
function mdToHtml(text: string): string {
  // Minimal, safe formatting: escape, then bold + line breaks.
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="px-1 rounded bg-white/10">$1</code>')
    .replace(/\n/g, "<br>");
}
function bubble(m: AiMessage): HTMLElement {
  const el = document.createElement("div");
  if (m.role === "user") {
    el.className = "flex justify-end";
    el.innerHTML = `<div class="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm" style="background:var(--veil-accent);color:#fff">${escapeHtml(m.content)}</div>`;
  } else {
    el.className = "flex items-start gap-3";
    el.innerHTML = `
      <span class="grid place-items-center h-8 w-8 rounded-lg shrink-0 mt-0.5" style="background:var(--veil-accent-soft);color:var(--veil-accent)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-4.6 2.9L16 19l-4-3.6L8 19l1.1-6.1L4.5 10l5.6-1.4z"/></svg>
      </span>
      <div class="glass rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-relaxed text-[#e7e9ef] max-w-[85%]">${mdToHtml(m.content)}</div>`;
  }
  return el;
}

async function renderAi() {
  $("meta").textContent = "";
  const results = $("results");
  const wrap = document.createElement("div");
  wrap.className = "max-w-2xl";
  const messagesEl = document.createElement("div");
  messagesEl.className = "space-y-4";
  const videosEl = document.createElement("div");
  videosEl.className = "mt-8";
  wrap.appendChild(messagesEl);
  wrap.appendChild(videosEl);
  results.appendChild(wrap);

  const renderMessages = () => {
    messagesEl.innerHTML = "";
    chat.forEach((m) => messagesEl.appendChild(bubble(m)));
  };

  let videosShown = false;
  async function showVideos() {
    if (videosShown) return;
    videosShown = true;
    const videos = (await veil.search(query, "videos").catch(() => [])) as VideoResult[];
    if (videos.length) {
      videosEl.appendChild(videoSection(videos.slice(0, 6), "Passende Videos"));
      wireImages(videosEl);
    }
  }

  async function ask(text: string) {
    chat.push({ role: "user", content: text });
    renderMessages();
    const thinking = document.createElement("div");
    thinking.className = "flex items-center gap-3 text-sm text-[#9aa0ad]";
    thinking.innerHTML = `<span class="h-4 w-4 rounded-full border-2 border-white/20 border-t-[var(--veil-accent)] animate-spin"></span> Veil AI denkt nach…`;
    messagesEl.appendChild(thinking);
    const reply = await veil.aiChat(chat);
    thinking.remove();
    if (reply.error === "no-key") {
      chat.pop();
      messagesEl.appendChild(keyPrompt());
      return;
    }
    chat.push({ role: "assistant", content: reply.text || reply.error || "Es ist ein Fehler aufgetreten." });
    renderMessages();
    void showVideos();
  }

  // Reply box
  const box = document.createElement("div");
  box.className = "accent-ring glass glass-hover flex items-center gap-2 h-11 rounded-xl px-4 mt-5 sticky bottom-4";
  box.innerHTML = `<input id="ai-reply" type="text" placeholder="Frag Veil AI etwas…" class="flex-1 bg-transparent outline-none text-sm placeholder:text-[#6b7280]" />
    <button id="ai-send" class="grid place-items-center h-7 w-7 rounded-lg" style="background:var(--veil-accent);color:#fff"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg></button>`;
  wrap.appendChild(box);
  const replyInput = box.querySelector<HTMLInputElement>("#ai-reply")!;
  const send = () => {
    const t = replyInput.value.trim();
    if (t) { replyInput.value = ""; ask(t); }
  };
  box.querySelector("#ai-send")!.addEventListener("click", send);
  replyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  if (!chat.length && query) {
    await ask(query);
  } else {
    renderMessages();
    if (chat.some((m) => m.role === "assistant")) void showVideos();
  }
}

/** Compact AI answer card shown at the top of web results for questions. */
function aiAnswerCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "glass rounded-xl2 p-5";
  card.innerHTML = `
    <div class="flex items-center gap-2 mb-3">
      <span class="grid place-items-center h-6 w-6 rounded-md" style="background:var(--veil-accent-soft);color:var(--veil-accent)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-4.6 2.9L16 19l-4-3.6L8 19l1.1-6.1L4.5 10l5.6-1.4z"/></svg>
      </span>
      <span class="text-sm font-semibold">Veil AI</span>
    </div>
    <div data-body class="text-sm leading-relaxed text-[#e7e9ef]">
      <span class="inline-flex items-center gap-2 text-[#9aa0ad]"><span class="h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-[var(--veil-accent)] animate-spin"></span> denkt nach…</span>
    </div>`;
  const body = card.querySelector<HTMLElement>("[data-body]")!;
  (async () => {
    const reply = await veil.aiChat([{ role: "user", content: query }]);
    if (reply.error === "no-key") {
      body.innerHTML = `<span class="text-[#9aa0ad]">KI-Antworten aktivieren — </span><button class="underline" style="color:var(--veil-accent)">Anthropic-Key in Einstellungen hinzufügen</button>`;
      body.querySelector("button")!.addEventListener("click", () => (location.href = "veil://settings"));
      return;
    }
    chat = [{ role: "user", content: query }, { role: "assistant", content: reply.text || reply.error || "Fehler" }];
    body.innerHTML = mdToHtml(reply.text || reply.error || "Fehler") +
      `<div class="mt-3"><button class="text-xs px-3 py-1.5 rounded-lg glass glass-hover">Weiterfragen →</button></div>`;
    body.querySelector("button")!.addEventListener("click", () => { tab = "ai"; renderTabs(); run(); window.scrollTo(0, 0); });
  })();
  return card;
}

function keyPrompt(): HTMLElement {
  const el = document.createElement("div");
  el.className = "glass rounded-xl2 p-5 text-center";
  el.innerHTML = `
    <div class="mx-auto mb-3 grid place-items-center h-11 w-11 rounded-xl" style="background:var(--veil-accent-soft);color:var(--veil-accent)">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-4.6 2.9L16 19l-4-3.6L8 19l1.1-6.1L4.5 10l5.6-1.4z"/></svg>
    </div>
    <div class="text-sm font-semibold mb-1">Veil AI aktivieren</div>
    <p class="text-xs text-[#9aa0ad] mb-4">Füge einen Anthropic API-Key in den Einstellungen hinzu, um KI-Antworten zu erhalten. Der Key bleibt lokal auf deinem Gerät.</p>
    <button class="text-sm px-4 py-2 rounded-lg" style="background:var(--veil-accent);color:#fff">Zu den Einstellungen</button>`;
  el.querySelector("button")!.addEventListener("click", () => (location.href = "veil://settings"));
  return el;
}

/** Bottom-of-page block: related searches ("Ähnliche Suchen") + pager. */
async function relatedAndPager(): Promise<HTMLElement> {
  const box = document.createElement("div");
  box.className = "mt-12";

  const suggestions = await veil.suggest(query).catch(() => [] as string[]);
  if (suggestions.length) {
    const sec = document.createElement("div");
    sec.innerHTML = `<div class="flex items-center gap-2 mb-3">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--veil-accent)" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <span class="text-sm font-semibold">Ähnliche Suchen</span></div>`;
    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 sm:grid-cols-2 gap-2.5";
    suggestions.forEach((s) => {
      const b = document.createElement("button");
      b.className = "flex items-center gap-3 text-left px-4 py-2.5 rounded-full glass glass-hover text-sm text-[#c7ccd6]";
      b.innerHTML = `<svg class="text-[#6b7280] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><span>${escapeHtml(s)}</span>`;
      b.addEventListener("click", () => (location.href = `veil://search?q=${encodeURIComponent(s)}`));
      grid.appendChild(b);
    });
    sec.appendChild(grid);
    box.appendChild(sec);
  }

  const pager = document.createElement("div");
  pager.className = "flex items-center justify-center gap-3 mt-10";
  const mkBtn = (label: string, delta: number) => {
    const b = document.createElement("button");
    b.className = "flex items-center gap-2 px-5 py-2.5 rounded-full glass glass-hover text-sm";
    b.innerHTML = label;
    b.addEventListener("click", () => {
      offset = Math.max(0, offset + delta);
      window.scrollTo(0, 0);
      run();
    });
    return b;
  };
  if (offset > 0) pager.appendChild(mkBtn(`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg> Zurück`, -20));
  pager.appendChild(mkBtn(`Nächste <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`, 20));
  box.appendChild(pager);
  return box;
}

function showEmpty() {
  $("meta").textContent = "";
  const empty = $("empty");
  empty.classList.remove("hidden");
  empty.textContent = "Keine Ergebnisse gefunden. Versuch es mit anderen Suchbegriffen.";
}

async function init() {
  const applyTheme = (t: string) => document.documentElement.classList.toggle("theme-light", t === "light");
  veil.getSettings().then((s) => applyTheme(s.theme));
  veil.onSettings((s) => applyTheme(s.theme));
  const input = $("q") as HTMLInputElement;
  query = getQuery();
  input.value = query;
  document.title = query ? `${query} · Veil Suche` : "Veil Suche";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      location.href = `veil://search?q=${encodeURIComponent(input.value.trim())}`;
    }
  });
  renderTabs();
  if (query) run();
  else input.focus();
}

init();
