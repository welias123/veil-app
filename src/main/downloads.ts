import { app, Session, shell } from "electron";
import path from "node:path";
import { DownloadItem } from "../shared/types";
import { store } from "./settings";

/**
 * Brave-style downloads: intercept session downloads, save them straight to the
 * user's Downloads folder (no save dialog), and expose live progress so the UI
 * can show a shelf/panel with speed, ETA, pause/resume and a stop button.
 */

let items: DownloadItem[] = [];
let notify: (list: DownloadItem[]) => void = () => {};

// Keep the live Electron DownloadItem around so we can pause/resume/cancel it.
const handles = new Map<string, Electron.DownloadItem>();
// Sampling state per download for a smoothed speed (bytes/sec).
const samples = new Map<string, { t: number; bytes: number; speed: number }>();

export function getDownloads(): DownloadItem[] {
  return items;
}
export function onDownloadsUpdate(cb: (list: DownloadItem[]) => void) {
  notify = cb;
}

export function setupDownloads(session: Session) {
  session.on("will-download", (_e, item) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // If the user opted for "ask where to save", leave the save path unset so
    // Electron shows the native save dialog; otherwise auto-save to Downloads.
    const ask = store.getSettings().askDownloadLocation;
    let target = "";
    if (!ask) {
      target = uniquePath(item.getFilename());
      item.setSavePath(target);
    }
    handles.set(id, item);
    samples.set(id, { t: Date.now(), bytes: 0, speed: 0 });

    const rec: DownloadItem = {
      id,
      filename: target ? path.basename(target) : item.getFilename(),
      url: item.getURL(),
      state: "progressing",
      received: 0,
      total: item.getTotalBytes(),
      path: target,
      startTime: Date.now(),
      speed: 0,
      paused: false,
    };
    items = [rec, ...items].slice(0, 50);
    notify(items);

    item.on("updated", (_ev, state) => {
      rec.received = item.getReceivedBytes();
      rec.total = item.getTotalBytes();
      rec.paused = item.isPaused();
      rec.speed = rec.paused ? 0 : sampleSpeed(id, rec.received);
      // "interrupted" here means the transfer stalled; keep it as progressing
      // unless the download is actually paused so the UI keeps the stop button.
      rec.state = state === "interrupted" && !rec.paused ? "interrupted" : "progressing";
      notify(items);
    });
    item.once("done", (_ev, state) => {
      rec.state =
        state === "completed" ? "completed" : state === "cancelled" ? "cancelled" : "interrupted";
      rec.received = item.getReceivedBytes();
      rec.speed = 0;
      rec.paused = false;
      // With the save dialog, the real path is only known once chosen.
      const saved = item.getSavePath();
      if (saved) { rec.path = saved; rec.filename = path.basename(saved); }
      handles.delete(id);
      samples.delete(id);
      notify(items);
    });
  });
}

/** Exponentially-smoothed transfer speed in bytes/sec. */
function sampleSpeed(id: string, received: number): number {
  const s = samples.get(id);
  const now = Date.now();
  if (!s) return 0;
  const dt = (now - s.t) / 1000;
  if (dt < 0.2) return s.speed; // too soon; reuse last value to avoid noise
  const inst = Math.max(0, (received - s.bytes) / dt);
  // Smooth so the number doesn't jump around every tick.
  const speed = s.speed > 0 ? s.speed * 0.6 + inst * 0.4 : inst;
  samples.set(id, { t: now, bytes: received, speed });
  return speed;
}

/** Avoid clobbering existing files: foo.zip → foo (1).zip. */
function uniquePath(filename: string): string {
  const dir = app.getPath("downloads");
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let i = 1;
  const fs = require("node:fs") as typeof import("node:fs");
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i++})${ext}`);
  }
  return candidate;
}

export function openDownload(id: string) {
  const r = items.find((i) => i.id === id);
  if (r?.path) shell.openPath(r.path);
}
export function showDownload(id: string) {
  const r = items.find((i) => i.id === id);
  if (r?.path) shell.showItemInFolder(r.path);
}
export function cancelDownload(id: string) {
  handles.get(id)?.cancel();
}
export function pauseDownload(id: string) {
  const h = handles.get(id);
  if (!h) return;
  h.pause();
  const r = items.find((i) => i.id === id);
  if (r) {
    r.paused = true;
    r.speed = 0;
    notify(items);
  }
}
export function resumeDownload(id: string) {
  const h = handles.get(id);
  if (!h || !h.canResume()) return;
  h.resume();
  const r = items.find((i) => i.id === id);
  if (r) {
    r.paused = false;
    notify(items);
  }
}
export function clearDownloads() {
  items = items.filter((i) => i.state === "progressing");
  notify(items);
}
