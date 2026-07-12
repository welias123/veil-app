import { Session } from "electron";
import fetch from "cross-fetch";
import { ElectronBlocker, Request } from "@ghostery/adblocker-electron";
import { store } from "./settings";
import { Settings } from "../shared/types";

/**
 * Brave-style Shields: high-performance network + cosmetic blocking via the
 * Ghostery engine, plus HTTPS upgrading and optional script blocking.
 *
 * IMPORTANT: Electron allows only ONE `webRequest.onBeforeRequest` listener per
 * session. The blocker installs its own; if we then register a second one for
 * HTTPS/script handling it silently REPLACES the blocker's and nothing gets
 * blocked. So we own the single listener and DELEGATE to `blocker.onBeforeRequest`.
 *
 * We cache the built engine INSTANCE (not serialized bytes) so its scriptlet /
 * redirect resources stay intact — those are what keep sites like YouTube
 * playing while their ads are neutralised. Per-site pauses are applied as
 * document-level exception filters.
 */

const AVG_BLOCKED_BYTES = 55 * 1024;

// Cached engines per level. Building fetches large lists, so we do it once.
const engineCache: { full?: ElectronBlocker; ads?: ElectronBlocker } = {};
// Which allowlist filters are currently applied to each engine instance.
const appliedAllowlist = new WeakMap<ElectronBlocker, string[]>();
const wired = new WeakSet<ElectronBlocker>();

let blocker: ElectronBlocker | null = null;

const TRACKER_HINTS = [
  "analytics", "track", "telemetry", "metric", "pixel", "beacon",
  "stat", "collect", "sentry", "segment", "mixpanel", "hotjar",
];

function classify(request: Request): "tracker" | "ad" {
  const host = request.hostname || "";
  return TRACKER_HINTS.some((h) => host.includes(h)) ? "tracker" : "ad";
}

async function getEngine(aggressive: boolean): Promise<ElectronBlocker> {
  const key = aggressive ? "full" : "ads";
  if (engineCache[key]) return engineCache[key]!;
  let engine: ElectronBlocker;
  try {
    engine = aggressive
      ? await ElectronBlocker.fromPrebuiltFull(fetch)
      : await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
  } catch (err) {
    console.warn("[veil] filter list fetch failed, using empty engine:", err);
    engine = ElectronBlocker.empty();
  }
  engineCache[key] = engine;
  return engine;
}

// Always-exempt domains: YouTube's player breaks if the engine injects its
// cosmetic/scriptlet code (e.g. "JSONPath already declared"), so we disable ALL
// blocking (network + cosmetic) there via document-level exceptions.
const BUILTIN_ALLOW = ["youtube.com", "youtu.be", "youtube-nocookie.com"];

/** Sync the engine's per-site exceptions to the current allowlist (diff-based). */
function syncAllowlist(engine: ElectronBlocker, allowlist: string[]) {
  const filt = (d: string) => `@@||${d}^$document`;
  const desired = [...new Set([...BUILTIN_ALLOW, ...allowlist])];
  const prev = appliedAllowlist.get(engine) ?? [];
  const added = desired.filter((d) => !prev.includes(d)).map(filt);
  const removed = prev.filter((d) => !desired.includes(d)).map(filt);
  if (added.length || removed.length) {
    engine.updateFromDiff({ added, removed });
  }
  appliedAllowlist.set(engine, [...desired]);
}

// YouTube fights network ad-blocking: blocking its ad requests makes the player
// refuse to load the video (readyState stays 0 → black screen). So we skip
// blocking entirely for tabs currently on YouTube — tracked reliably by their
// webContents id (details.webContents/referrer are unreliable in onBeforeRequest).
const youtubeContents = new Set<number>();
export function markYouTubeContents(id: number, isYouTube: boolean) {
  if (isYouTube) youtubeContents.add(id);
  else youtubeContents.delete(id);
}

function wireStats(engine: ElectronBlocker) {
  if (wired.has(engine)) return;
  wired.add(engine);
  engine.on("request-blocked", (request: Request) => {
    const kind = classify(request);
    store.bumpStats({
      requestsBlocked: 1,
      bytesSaved: AVG_BLOCKED_BYTES,
      trackersBlocked: kind === "tracker" ? 1 : 0,
      adsBlocked: kind === "ad" ? 1 : 0,
    });
  });
}

/** (Re)build the engine for the given settings and attach it to a session. */
export async function applyShields(session: Session, settings: Settings): Promise<void> {
  if (blocker) {
    try {
      blocker.disableBlockingInSession(session);
    } catch {
      /* not previously enabled */
    }
    blocker = null;
  }

  if (settings.shieldLevel !== "off") {
    blocker = await getEngine(settings.shieldLevel === "aggressive");
    syncAllowlist(blocker, settings.allowlist);
    wireStats(blocker);
    // NOTE: we deliberately do NOT call blocker.enableBlockingInSession(session).
    // That path injects cosmetic filters + scriptlets into every page from the
    // main process via executeJavaScript — which throws on Trusted-Types pages
    // like YouTube ("Script failed to execute") and breaks the player. We keep
    // the important part — network blocking + redirects — through our own
    // installRequestHandler below, which delegates to blocker.onBeforeRequest.
  }

  installRequestHandler(session, settings);
}

export function invalidateEngine() {
  blocker = null;
}

function installRequestHandler(session: Session, settings: Settings) {
  const active = blocker;
  session.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    // 0) Never network-block requests from a YouTube tab (its player breaks).
    if (details.webContentsId !== undefined && youtubeContents.has(details.webContentsId)) {
      return callback({});
    }

    // 1) HTTPS Everywhere
    if (settings.httpsEverywhere && details.url.startsWith("http://")) {
      const isLocal = /:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(details.url);
      const isOnion = /\.onion(\/|$|:)/.test(details.url);
      if (!isLocal && !isOnion) {
        return callback({ redirectURL: details.url.replace(/^http:/, "https:") });
      }
    }

    // 2) Script blocker (opt-in): drop cross-origin scripts.
    if (settings.blockScripts && details.resourceType === "script") {
      if (!safeSameOrigin(details.referrer, details.url)) {
        store.bumpStats({ requestsBlocked: 1, bytesSaved: AVG_BLOCKED_BYTES });
        return callback({ cancel: true });
      }
    }

    // 3) Delegate to the ad/tracker engine (real blocking + redirects + stats).
    if (active) return active.onBeforeRequest(details, callback);
    return callback({});
  });
}

function safeSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return true;
  }
}
