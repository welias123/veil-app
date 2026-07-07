import fetch from "cross-fetch";
import { NewsResult, SearchResult, VideoResult } from "../shared/types";

/**
 * Veil Search backend. We fetch real results from DuckDuckGo's HTML endpoint
 * (server-side, so no CORS and no branding leaks to the user), strip the
 * sponsored/ad entries, decode the real destination URLs, and hand clean
 * results back to the Veil-styled results page. The user never sees DuckDuckGo.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<real>. Decode it. */
function decodeUddg(href: string): string | null {
  try {
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return "https:" + href;
    return null;
  } catch {
    return null;
  }
}

function isAd(url: string): boolean {
  return /duckduckgo\.com\/y\.js|ad_provider=|ad_domain=|\.bing\.com\/aclick/i.test(url);
}

export async function veilSearch(query: string, offset = 0): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const off = Math.max(0, offset | 0);
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}${off ? `&s=${off}&dc=${off + 1}` : ""}`;
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9,en;q=0.8" },
    });
    html = await res.text();
  } catch (err: any) {
    console.warn("[veil:search] fetch failed:", err?.message ?? err);
    return [];
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // Split into per-result blocks so title and snippet stay aligned.
  const blocks = html.split(/<div class="result[ "]/).slice(1);
  for (const block of blocks) {
    const a = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const real = decodeUddg(a[1].replace(/&amp;/g, "&"));
    if (!real || isAd(real) || seen.has(real)) continue;

    const title = stripTags(a[2]);
    if (!title) continue;

    const sn = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = sn ? stripTags(sn[1]) : "";

    seen.add(real);
    results.push({ title, url: real, snippet });
    if (results.length >= 20) break;
  }

  return results;
}

const ddgHeaders = { "User-Agent": UA, Referer: "https://duckduckgo.com/", "Accept-Language": "de-DE,de;q=0.9,en;q=0.8" };

/** Related-search suggestions via DuckDuckGo autocomplete. */
export async function veilSuggest(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&kl=de-de`, {
      headers: { "User-Agent": UA },
    });
    const j: any = await res.json();
    return (Array.isArray(j) ? j : [])
      .map((r: any) => r.phrase)
      .filter((p: string) => p && p.toLowerCase() !== q.toLowerCase())
      .slice(0, 8);
  } catch {
    return [];
  }
}

/** DuckDuckGo's media verticals need a per-query token scraped from the page. */
async function getVqd(query: string): Promise<string | null> {
  try {
    const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": UA } });
    const html = await res.text();
    return html.match(/vqd="([0-9-]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function veilVideos(query: string): Promise<VideoResult[]> {
  const q = query.trim();
  if (!q) return [];
  const vqd = await getVqd(q);
  if (!vqd) return [];
  try {
    const res = await fetch(
      `https://duckduckgo.com/v.js?l=de-de&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}`,
      { headers: ddgHeaders }
    );
    const j: any = await res.json();
    return (j.results ?? [])
      .map((r: any): VideoResult => ({
        title: r.title ?? "",
        url: r.content ?? "",
        thumbnail: r.images?.medium || r.images?.large || r.images?.small || "",
        duration: r.duration ?? "",
        publisher: r.publisher ?? "",
      }))
      .filter((v: VideoResult) => v.url && v.title)
      .slice(0, 40);
  } catch {
    return [];
  }
}

export async function veilNews(query: string): Promise<NewsResult[]> {
  const q = query.trim();
  if (!q) return [];
  const vqd = await getVqd(q);
  if (!vqd) return [];
  try {
    const res = await fetch(
      `https://duckduckgo.com/news.js?l=de-de&o=json&noamp=1&q=${encodeURIComponent(q)}&vqd=${vqd}`,
      { headers: ddgHeaders }
    );
    const j: any = await res.json();
    return (j.results ?? [])
      .map((r: any): NewsResult => ({
        title: r.title ?? "",
        url: r.url ?? "",
        excerpt: r.excerpt ?? "",
        source: r.source ?? "",
        date: r.date ?? 0,
      }))
      .filter((n: NewsResult) => n.url && n.title)
      .slice(0, 25);
  } catch {
    return [];
  }
}
