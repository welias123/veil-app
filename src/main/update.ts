import { app, net } from "electron";
import fetch from "cross-fetch";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UpdateInfo, UpdateProgress } from "../shared/types";
import { meta, StagedUpdate } from "./meta";

/**
 * Update flow for the portable Windows build (Veil-win32-x64 / win-unpacked):
 *  1. On launch we fetch a small version.json and, if it advertises a newer
 *     version, surface an in-app "update available" prompt.
 *  2. "Herunterladen" streams the new ZIP in-app (with live progress), extracts
 *     it to a temp folder and stages it — no installer, no navigation.
 *  3. "Starte Veil neu" hands off to a tiny detached helper that waits for this
 *     process to exit, copies the staged files over the install directory and
 *     relaunches Veil.
 *
 * macOS has no in-app updater (unsigned file-swap would be Gatekeeper-blocked);
 * there the prompt just points at the website download.
 */
const VERSION_URL = "https://welias123.github.io/veil-website/version.json";

let cached: UpdateInfo | null = null;
export function getUpdate(): UpdateInfo | null {
  return cached;
}

let notifyProgress: (p: UpdateProgress) => void = () => {};
export function onUpdateProgress(cb: (p: UpdateProgress) => void) {
  notifyProgress = cb;
}

/** Returns update info if a newer version is available, else null. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      headers: { "cache-control": "no-cache" },
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const latest = String(j.version || "").trim();
    if (!latest) return null;
    if (isNewer(latest, app.getVersion())) {
      cached = {
        version: latest,
        notes: String(j.notes || ""),
        url: String(j.url || "https://welias123.github.io/veil-website/"),
      };
      // A staged update for an OLDER version is now obsolete — drop it so we
      // don't offer a stale "restart".
      const staged = meta.get("staged");
      if (staged && !isNewer(staged.version, latest) && staged.version !== latest) {
        clearStaged();
      }
      return cached;
    }
  } catch {
    /* offline — no update prompt */
  }
  return null;
}

/** A staged, ready-to-apply update whose files still exist on disk. */
export function getStagedUpdate(): StagedUpdate | null {
  const s = meta.get("staged");
  if (!s) return null;
  if (!fs.existsSync(path.join(s.dir, "Veil.exe"))) {
    clearStaged();
    return null;
  }
  return s;
}

function clearStaged() {
  const s = meta.get("staged");
  meta.set("staged", null);
  if (s?.dir) {
    try {
      fs.rmSync(path.dirname(s.dir), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Download the update ZIP with live progress, extract it and stage the files.
 * Resolves with the staged version; rejects on failure. Windows only.
 */
let inFlight: Promise<string> | null = null;
export function downloadUpdate(): Promise<string> {
  // Dedup: the background auto-download and a manual click share one download.
  if (!inFlight) {
    inFlight = doDownloadUpdate().finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function doDownloadUpdate(): Promise<string> {
  if (process.platform !== "win32") throw new Error("In-App-Update nur unter Windows");
  const info = cached;
  if (!info) throw new Error("Kein Update verfügbar");

  const zipUrl =
    info.url && info.url.endsWith(".zip")
      ? info.url
      : "https://github.com/welias123/veil-website/releases/latest/download/Veil-Windows.zip";

  const root = path.join(os.tmpdir(), "veil-update");
  const extractDir = path.join(root, "extracted");
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(root, { recursive: true });
  const zipPath = path.join(root, "update.zip");

  notifyProgress({ phase: "downloading", version: info.version, percent: 0, received: 0, total: 0, speed: 0 });
  await downloadToFile(zipUrl, zipPath, info.version);

  notifyProgress({ phase: "extracting", version: info.version, percent: 100, received: 0, total: 0, speed: 0 });
  await extractZip(zipPath, extractDir);

  const appDir = findAppDir(extractDir);
  if (!appDir) throw new Error("Update-Paket ungültig (Veil.exe nicht gefunden)");

  const staged: StagedUpdate = { version: info.version, dir: appDir };
  meta.set("staged", staged);
  notifyProgress({ phase: "ready", version: info.version, percent: 100, received: 0, total: 0, speed: 0 });
  return info.version;
}

/** Stream a URL to a file, reporting download progress (bytes + speed). */
function downloadToFile(url: string, dest: string, version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url); // follows redirects (GitHub → CDN) by default
    request.on("response", (response) => {
      if (response.statusCode >= 400) {
        reject(new Error(`Download fehlgeschlagen (HTTP ${response.statusCode})`));
        return;
      }
      const total = Number((response.headers["content-length"] as string) || 0);
      let received = 0;
      let lastT = Date.now();
      let lastBytes = 0;
      let speed = 0;
      const out = fs.createWriteStream(dest);
      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        out.write(chunk);
        const now = Date.now();
        const dt = (now - lastT) / 1000;
        if (dt >= 0.25) {
          const inst = (received - lastBytes) / dt;
          speed = speed > 0 ? speed * 0.6 + inst * 0.4 : inst;
          lastT = now;
          lastBytes = received;
          notifyProgress({
            phase: "downloading",
            version,
            percent: total ? Math.min(99, Math.round((received / total) * 100)) : 0,
            received,
            total,
            speed,
          });
        }
      });
      response.on("end", () => out.end(() => resolve()));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

/** Extract a .zip via PowerShell's built-in Expand-Archive (Windows). */
function extractZip(zip: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {}
    const ps = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`,
      ],
      { windowsHide: true }
    );
    ps.on("error", reject);
    ps.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Entpacken fehlgeschlagen (Code ${code})`))
    );
  });
}

/** Find the folder inside the extracted tree that contains Veil.exe. */
function findAppDir(root: string): string | null {
  if (fs.existsSync(path.join(root, "Veil.exe"))) return root;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findAppDir(path.join(root, e.name));
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Apply the staged update: spawn a detached helper that waits for us to exit,
 * mirrors the staged files over the install directory and relaunches Veil.
 */
export function applyUpdate(): boolean {
  const staged = getStagedUpdate();
  if (!staged) return false;
  const installDir = path.dirname(app.getPath("exe"));
  const exePath = app.getPath("exe");

  const tempRoot = path.join(os.tmpdir(), "veil-update");
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    `try { Wait-Process -Id ${process.pid} -Timeout 30 } catch {}`,
    "Start-Sleep -Milliseconds 600",
    // /E all subdirs (incl. empty), retry a couple times for briefly-locked files.
    `robocopy "${staged.dir}" "${installDir}" /E /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null`,
    `Start-Process -FilePath "${exePath}"`,
    // Free the ~113 MB temp copy once it's been applied.
    `Remove-Item -Recurse -Force "${tempRoot}"`,
  ].join("\r\n");

  const scriptPath = path.join(os.tmpdir(), `veil-apply-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, script, "utf8");

  const child = spawn(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath],
    { detached: true, stdio: "ignore", windowsHide: true }
  );
  child.unref();

  meta.set("staged", null); // the files are being consumed by the helper now
  setTimeout(() => app.quit(), 200);
  return true;
}

/**
 * On startup: if a newer update was already downloaded in a previous session,
 * apply it immediately and relaunch — so the app auto-updates seamlessly
 * (Chrome-style: staged in the background, swapped in on next launch).
 * Only ever runs in a packaged Windows build (never in dev / on macOS).
 */
export function applyStagedOnStartup(): boolean {
  if (!app.isPackaged || process.platform !== "win32") return false;
  const staged = getStagedUpdate();
  if (staged && isNewer(staged.version, app.getVersion())) {
    return applyUpdate();
  }
  return false;
}

/**
 * Silently download + stage the available update in the background so the next
 * launch already has it. No user interaction. Packaged Windows only.
 */
export async function autoDownloadUpdate(): Promise<void> {
  if (!app.isPackaged || process.platform !== "win32") return;
  if (!cached) return;
  const staged = getStagedUpdate();
  if (staged && staged.version === cached.version) return; // already have it
  try {
    await downloadUpdate();
  } catch {
    /* silent — the user can still trigger it from the update modal */
  }
}

/** Semver-ish compare: is a strictly newer than b? */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n) || 0);
  const pb = b.split(".").map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}
