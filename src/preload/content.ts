import { ipcRenderer } from "electron";
import { IPC, Settings } from "../shared/types";

/**
 * Runs inside every web tab (isolated world, sandboxed). Provides two
 * privacy features that complement the network/cosmetic engine:
 *   1. Fingerprint protection — injected into the page's main world so it can
 *      shadow real browser APIs before page scripts read them.
 *   2. Cookie-banner auto-handling — heuristic click on reject/accept.
 */

// --- Main-world payload (serialized to a string; must be self-contained) ---
function fingerprintPayload() {
  try {
    // Canvas: add imperceptible per-read noise to defeat hash fingerprinting.
    const proto = HTMLCanvasElement.prototype as any;
    const origToDataURL = proto.toDataURL;
    proto.toDataURL = function (this: HTMLCanvasElement, ...args: any[]) {
      try {
        const ctx = this.getContext("2d");
        if (ctx) {
          const { width, height } = this;
          const img = ctx.getImageData(0, 0, width, height);
          for (let i = 0; i < img.data.length; i += 997) {
            img.data[i] = (img.data[i] + ((Math.random() * 2) | 0)) & 0xff;
          }
          ctx.putImageData(img, 0, 0);
        }
      } catch {
        /* tainted canvas etc. */
      }
      return origToDataURL.apply(this, args);
    };
    // NOTE: intentionally NO navigator/WebGL spoofing — those make the browser
    // look automated and get sites like ChatGPT/Gemini stuck on bot-checks.
    // Canvas noise alone defeats most hash fingerprinting without breaking sites.
  } catch {
    /* best-effort */
  }
}

function injectMainWorld(fn: () => void) {
  try {
    const code = `(${fn.toString()})();`;
    const script = document.createElement("script");
    const tt = (window as any).trustedTypes;
    if (tt && tt.createPolicy) {
      // Trusted-Types-enforced sites (Gemini, ChatGPT, …). Setting a string sink
      // logs a violation and can interfere — use a policy, or skip cleanly.
      try {
        const policy = tt.createPolicy("veil-" + Math.random().toString(36).slice(2), {
          createScript: (s: string) => s,
        });
        (script as any).text = policy.createScript(code);
      } catch {
        return; // policy not allowed → skip injection entirely (no error, no harm)
      }
    } else {
      script.textContent = code;
    }
    (document.documentElement || document.head || document).prepend(script);
    script.remove();
  } catch {
    /* degrade gracefully */
  }
}

// Sites whose strict Trusted-Types / players reject main-world injection — skip
// the fingerprint payload there so we never stall them.
function isFingerprintExempt(): boolean {
  const h = location.hostname;
  return /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$|(^|\.)google\.com$|(^|\.)chatgpt\.com$|(^|\.)openai\.com$/.test(h);
}

// --- Cookie banner heuristics ---
const REJECT_WORDS = [
  "reject all", "alle ablehnen", "ablehnen", "decline", "necessary only",
  "nur notwendige", "essenzielle", "refuse",
];
const ACCEPT_WORDS = ["accept all", "alle akzeptieren", "akzeptieren", "agree", "i agree", "got it", "verstanden"];

function handleCookieBanner(preferReject: boolean) {
  const words = preferReject ? REJECT_WORDS : ACCEPT_WORDS;
  const clickable = Array.from(
    document.querySelectorAll<HTMLElement>("button, a, [role=button], input[type=button], input[type=submit]")
  );
  for (const el of clickable) {
    const label = (el.innerText || (el as HTMLInputElement).value || "").trim().toLowerCase();
    if (!label || label.length > 40) continue;
    if (words.some((w) => label === w || label.includes(w))) {
      el.click();
      return true;
    }
  }
  return false;
}

// --- Match search-engine result pages to the Veil chrome background ---
const SEARCH_HOSTS = ["duckduckgo.com", "google.", "bing.com", "startpage.com", "search.brave.com", "ecosia.org"];
function matchSearchBackground() {
  const host = location.hostname;
  if (!SEARCH_HOSTS.some((h) => host.includes(h))) return;
  const style = document.createElement("style");
  style.textContent = "html,body{background-color:#0b0d13 !important;}";
  (document.head || document.documentElement).appendChild(style);
}

/**
 * YouTube anti-adblock bypass. YouTube detects the blocked ad request and shows
 * a "perform the action below to continue" overlay while pausing the video. We
 * remove that overlay, resume playback, and auto-skip any ad segments — the
 * reliable client-side approach (same idea uBlock scriptlets use).
 */
function youtubeBypass() {
  if (!location.hostname.endsWith("youtube.com")) return;

  const style = document.createElement("style");
  style.textContent = `
    ytd-enforcement-message-view-model,
    ytd-popup-container:has(ytd-enforcement-message-view-model),
    tp-yt-iron-overlay-backdrop,
    #player-ads, .ytp-ad-module, .video-ads, .ytp-ad-overlay-container,
    ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-companion-slot-renderer {
      display: none !important;
    }`;
  (document.head || document.documentElement).appendChild(style);

  let weMutedForAd = false;
  const tick = () => {
    // Remove the anti-adblock enforcement popup; skip/fast-forward ads (only
    // while YouTube marks an ad as showing, so the main video is never touched).
    let removedEnforcement = false;
    document.querySelectorAll<HTMLElement>("tp-yt-paper-dialog, ytd-enforcement-message-view-model").forEach((el) => {
      const t = (el.textContent || "").toLowerCase();
      if (/adblock|ad blocker|werbeblocker|aktion durch|fortzufahren/.test(t)) {
        (el.closest("ytd-popup-container") || el).remove();
        removedEnforcement = true;
      }
    });
    document.querySelectorAll("tp-yt-iron-overlay-backdrop").forEach((el) => {
      if (removedEnforcement) el.remove();
    });

    const player = document.querySelector(".html5-video-player");
    const video = document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
    const adShowing = !!player && player.classList.contains("ad-showing");

    if (adShowing && video) {
      // Real ad playing. Prefer the Skip button; otherwise fast-forward it (16×)
      // + mute. Only ever done while `ad-showing` is set, so the main video is
      // never touched.
      const skip = document.querySelector<HTMLElement>(
        ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button, .ytp-ad-skip-button-slot button"
      );
      if (skip) {
        skip.click();
      } else {
        if (!video.muted) { video.muted = true; weMutedForAd = true; }
        try { video.playbackRate = 16; } catch { /* clamped */ }
        if (video.paused) video.play().catch(() => {});
      }
    } else if (video) {
      // Back on the real video: undo our ad speed-up + mute.
      if (video.playbackRate > 2) { try { video.playbackRate = 1; } catch {} }
      if (weMutedForAd) { video.muted = false; weMutedForAd = false; }
      if (removedEnforcement && video.paused) video.play().catch(() => {});
    }
  };

  // A subtree MutationObserver on YouTube's huge DOM fires thousands of times
  // and slows page load badly. A light interval is enough for popups/ads.
  setInterval(tick, 500);
  tick();
}

async function main() {
  let settings: Settings | null = null;
  try {
    settings = await ipcRenderer.invoke(IPC.settingsGet);
  } catch {
    /* settings unavailable; use safe defaults */
  }

  // Canvas-noise fingerprint defence — only when the user enabled it, and never
  // on YouTube (its player + strict Trusted-Types reject the injection, which
  // showed up as "Script failed to execute" and could stall playback).
  if (settings?.fingerprintProtection && !isFingerprintExempt()) {
    injectMainWorld(fingerprintPayload);
  }

  if (settings?.blockCookieBanners) {
    const preferReject = settings.shieldLevel !== "off";
    // Banners often mount late; retry a few times.
    let tries = 0;
    const timer = setInterval(() => {
      if (handleCookieBanner(preferReject) || ++tries > 8) clearInterval(timer);
    }, 700);
    window.addEventListener("beforeunload", () => clearInterval(timer));
  }
}

/** Run fn once <html> exists — preloads execute before the document is parsed,
 *  so document.documentElement can be null and naive DOM access crashes the
 *  whole preload (which silently disables every protection on the page). */
function whenDocumentElement(fn: () => void) {
  if (document.documentElement) {
    fn();
    return;
  }
  const obs = new MutationObserver(() => {
    if (document.documentElement) {
      obs.disconnect();
      fn();
    }
  });
  obs.observe(document, { childList: true });
}

export function runContentProtections() {
  // Everything here touches the DOM, so wait for <html> to exist first.
  whenDocumentElement(() => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", main, { once: true });
    } else {
      main();
    }
    // Site-specific enhancements (DOM is shared with the page).
    matchSearchBackground();
    youtubeBypass();
  });
}
