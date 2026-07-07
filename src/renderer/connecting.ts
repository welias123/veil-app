import { Settings, TorRuntimeStatus } from "../shared/types";

/** Auto-connect-to-Tor page shown when the user opens a .onion address.
 *  Enables Tor (which auto-downloads it on first use), shows live progress,
 *  and navigates to the target once the network is ready. */
interface Veil {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  torStatus(): Promise<TorRuntimeStatus>;
  onTorStatus(cb: (s: TorRuntimeStatus) => void): void;
}
const veil = (window as any).veil as Veil;
const $ = (id: string) => document.getElementById(id)!;

const target = new URLSearchParams(location.search).get("u") ?? "";
let navigated = false;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function update(s: TorRuntimeStatus) {
  ($("bar") as HTMLElement).style.width = `${Math.max(5, s.progress)}%`;
  $("phase").textContent = s.message || "Verbinde…";
  if ((s.phase === "ready" || s.reachable) && target && !navigated) {
    navigated = true;
    $("phase").textContent = "Verbunden — lade Seite…";
    setTimeout(() => (location.href = target), 400);
  }
}

async function init() {
  $("host").textContent = hostOf(target);
  const settings = await veil.getSettings();
  document.documentElement.classList.toggle("theme-light", settings.theme === "light");
  if (!settings.torEnabled) await veil.setSettings({ torEnabled: true });
  veil.onTorStatus(update);
  update(await veil.torStatus());
}
init();
