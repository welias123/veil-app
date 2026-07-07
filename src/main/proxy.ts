import { Session } from "electron";
import { connect } from "node:net";
import { Settings } from "../shared/types";

/**
 * Dual-routing engine.
 *
 * We use a PAC (Proxy Auto-Config) script rather than a static proxy so a
 * single Electron session can route *.onion (and optionally all) traffic
 * through the local Tor SOCKS port while everything else stays DIRECT.
 * This avoids juggling multiple sessions per tab.
 */

function buildPac(settings: Settings): string {
  const socks = `SOCKS5 127.0.0.1:${settings.torSocksPort}`;
  if (settings.routeAllThroughTor && settings.torEnabled) {
    return `function FindProxyForURL(url, host){ return "${socks}"; }`;
  }
  // Route only .onion through Tor; DIRECT for everything else.
  return `function FindProxyForURL(url, host){
    if (shExpMatch(host, "*.onion") || dnsDomainIs(host, ".onion")) {
      return "${socks === "SOCKS5 127.0.0.1:0" ? "DIRECT" : socks}";
    }
    return "DIRECT";
  }`;
}

export async function applyProxy(session: Session, settings: Settings): Promise<void> {
  if (!settings.torEnabled) {
    // Tor off: onion sites won't resolve, but clearnet works normally.
    await session.setProxy({ mode: "direct" });
    return;
  }
  // Electron's `pacScript` expects a URL, not inline JS — so we hand it the PAC
  // as a data: URL. Passing raw script text triggers "Invalid proxy PAC url"
  // and silently disables routing.
  const pac = buildPac(settings);
  const dataUrl = "data:application/x-ns-proxy-autoconfig," + encodeURIComponent(pac);
  await session.setProxy({ mode: "pac_script", pacScript: dataUrl });
}

/** True if a URL's host is a Tor hidden service. */
export function isOnion(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".onion");
  } catch {
    return false;
  }
}

/** Probe whether a Tor SOCKS daemon is listening on the configured port. */
export function checkTor(port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
