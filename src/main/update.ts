import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { UpdateInfo, UpdateProgress } from "../shared/types";

/**
 * Auto-update via electron-updater (the standard, robust mechanism — the same
 * one Pulsewave uses). It reads the release's latest.yml, downloads only the
 * changed blocks (delta), and installs through NSIS on quit. This replaced a
 * hand-rolled "download the whole zip + robocopy over the install dir" updater
 * that could fail to apply and re-prompted on every launch.
 *
 * Behaviour: silent. On launch we check + auto-download; the update is installed
 * automatically when the app quits, so the next launch is the new version. No
 * modal, no per-percent re-render, no full re-download.
 */
let cached: UpdateInfo | null = null;
let downloaded = false;
let notifyProgress: (p: UpdateProgress) => void = () => {};

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null; // no noisy file logging

function notes(info: { releaseNotes?: string | { note: string | null }[] | null }): string {
  return typeof info.releaseNotes === "string" ? info.releaseNotes : "";
}

autoUpdater.on("update-available", (info) => {
  cached = { version: info.version, notes: notes(info), url: "" };
});
autoUpdater.on("download-progress", (p) => {
  notifyProgress({
    phase: "downloading",
    version: cached?.version || "",
    percent: Math.round(p.percent),
    received: p.transferred,
    total: p.total,
    speed: p.bytesPerSecond,
  });
});
autoUpdater.on("update-downloaded", (info) => {
  downloaded = true;
  cached = { version: info.version, notes: notes(info), url: "" };
  notifyProgress({ phase: "ready", version: info.version, percent: 100, received: 0, total: 0, speed: 0 });
});
autoUpdater.on("error", (err) => {
  notifyProgress({ phase: "error", version: "", percent: 0, received: 0, total: 0, speed: 0, error: String((err as Error)?.message || err) });
});

export function getUpdate(): UpdateInfo | null {
  return cached;
}
export function onUpdateProgress(cb: (p: UpdateProgress) => void) {
  notifyProgress = cb;
}

/** Check for a newer version. Auto-downloads it in the background if found. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!app.isPackaged) return null; // dev build: no updater
  try {
    const res = await autoUpdater.checkForUpdates();
    return res && res.updateInfo && cached ? cached : null;
  } catch {
    return null;
  }
}

/** electron-updater auto-downloads on its own; kept for call-site compatibility. */
export async function autoDownloadUpdate(): Promise<void> {
  /* no-op — autoDownload handles it */
}

/** electron-updater installs on quit, so there is no startup swap to do. */
export function applyStagedOnStartup(): boolean {
  return false;
}

/** Manually trigger a download (auto-download already does this). */
export async function downloadUpdate(): Promise<string> {
  await autoUpdater.downloadUpdate();
  return cached?.version || "";
}

/** Install the downloaded update now and relaunch. */
export function applyUpdate(): boolean {
  if (!downloaded) return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

/** The already-downloaded (ready to install) update, if any. */
export function getStagedUpdate(): { version: string } | null {
  return downloaded && cached ? { version: cached.version } : null;
}
