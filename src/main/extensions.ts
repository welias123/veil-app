import { app, BrowserWindow, dialog, net, Session } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ExtensionInfo } from "../shared/types";
import { store } from "./settings";

/**
 * Unpacked Chrome-extension support. Users point Veil at an extension folder
 * (containing manifest.json); Veil loads it into the tab session and remembers
 * the path so it re-loads on next launch. (Web Store install isn't possible in
 * Electron, but most privacy extensions can be loaded unpacked.)
 */

// Use session.extensions (Electron 35+) if present, else the Session-level API.
function ext(ses: Session): any {
  return (ses as any).extensions || ses;
}

function toInfo(e: any): ExtensionInfo {
  return { id: e.id, name: e.name, version: e.version || e.manifest?.version || "", path: e.path };
}

export function listExtensions(ses: Session): ExtensionInfo[] {
  try {
    return ext(ses).getAllExtensions().map(toInfo);
  } catch {
    return [];
  }
}

/** Re-load every remembered extension at startup; drop paths that no longer exist. */
export async function loadStoredExtensions(ses: Session) {
  const paths = store.getSettings().extensions || [];
  const ok: string[] = [];
  for (const p of paths) {
    if (!fs.existsSync(path.join(p, "manifest.json"))) continue;
    try {
      await ext(ses).loadExtension(p, { allowFileAccess: true });
      ok.push(p);
    } catch {
      /* broken extension — skip */
    }
  }
  if (ok.length !== paths.length) store.setSettings({ extensions: ok });
}

/** Prompt for a folder, load it as an extension, and remember it. */
export async function addExtension(ses: Session, win: BrowserWindow): Promise<ExtensionInfo[]> {
  const res = await dialog.showOpenDialog(win, {
    title: "Erweiterung laden (Ordner mit manifest.json)",
    properties: ["openDirectory"],
  });
  const dir = res.filePaths[0];
  if (res.canceled || !dir) return listExtensions(ses);
  if (!fs.existsSync(path.join(dir, "manifest.json"))) {
    throw new Error("Der Ordner enthält keine manifest.json.");
  }
  await ext(ses).loadExtension(dir, { allowFileAccess: true });
  const cur = store.getSettings().extensions || [];
  if (!cur.includes(dir)) store.setSettings({ extensions: [...cur, dir] });
  return listExtensions(ses);
}

/** Extract the 32-char extension id from a Web Store URL or a raw id. */
function parseExtensionId(input: string): string | null {
  const raw = input.trim();
  const m = raw.match(/[a-p]{32}/);
  return m ? m[0] : null;
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = net.request(url); // follows redirects (Web Store → CDN)
    req.on("response", (res) => {
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
      const out = fs.createWriteStream(dest);
      res.on("data", (c: Buffer) => out.write(c));
      res.on("end", () => out.end(() => resolve()));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/** A .crx3 file is a "Cr24" header followed by a plain ZIP — strip the header. */
function crxToZip(crxPath: string, zipPath: string) {
  const buf = fs.readFileSync(crxPath);
  if (buf.length < 16 || buf.toString("latin1", 0, 4) !== "Cr24") {
    // Not a CRX (some CDNs return the zip directly) — use as-is.
    fs.copyFileSync(crxPath, zipPath);
    return;
  }
  const version = buf.readUInt32LE(4);
  // CRX2: header is 8 bytes + pubkey len + sig len. CRX3: 12 bytes + headerLen.
  let zipStart: number;
  if (version === 2) {
    const pubKeyLen = buf.readUInt32LE(8);
    const sigLen = buf.readUInt32LE(12);
    zipStart = 16 + pubKeyLen + sigLen;
  } else {
    const headerLen = buf.readUInt32LE(8);
    zipStart = 12 + headerLen;
  }
  fs.writeFileSync(zipPath, buf.subarray(zipStart));
}

function extractZip(zip: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dest, { recursive: true });
    const ps = spawn(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`],
      { windowsHide: true }
    );
    ps.on("error", reject);
    ps.on("close", (c) => (c === 0 ? resolve() : reject(new Error("Entpacken fehlgeschlagen"))));
  });
}

/** Download a Chrome Web Store extension by URL/id, unpack it and load it. */
export async function installFromWebStore(ses: Session, input: string): Promise<ExtensionInfo[]> {
  const id = parseExtensionId(input);
  if (!id) throw new Error("Keine gültige Erweiterungs-ID / Web-Store-Link erkannt.");
  const chrome = process.versions.chrome || "120.0.0.0";
  const url =
    `https://clients2.google.com/service/update2/crx?response=redirect` +
    `&prodversion=${chrome}&acceptformat=crx2,crx3` +
    `&x=id%3D${id}%26installsource%3Dondemand%26uc`;

  const tmp = path.join(os.tmpdir(), `veil-ext-${id}`);
  fs.mkdirSync(tmp, { recursive: true });
  const crx = path.join(tmp, "ext.crx");
  const zip = path.join(tmp, "ext.zip");
  await download(url, crx);
  crxToZip(crx, zip);

  // Persist unpacked into userData so it survives restarts.
  const destDir = path.join(app.getPath("userData"), "extensions", id);
  fs.rmSync(destDir, { recursive: true, force: true });
  await extractZip(zip, destDir);
  fs.rmSync(tmp, { recursive: true, force: true });

  if (!fs.existsSync(path.join(destDir, "manifest.json"))) {
    throw new Error("Download enthielt keine gültige Erweiterung.");
  }
  await ext(ses).loadExtension(destDir, { allowFileAccess: true });
  const cur = store.getSettings().extensions || [];
  if (!cur.includes(destDir)) store.setSettings({ extensions: [...cur, destDir] });
  return listExtensions(ses);
}

export function removeExtension(ses: Session, id: string): ExtensionInfo[] {
  const found = ext(ses).getAllExtensions().find((e: any) => e.id === id);
  const p = found?.path;
  try {
    ext(ses).removeExtension(id);
  } catch {
    /* ignore */
  }
  if (p) {
    store.setSettings({
      extensions: (store.getSettings().extensions || []).filter((x) => x !== p),
    });
  }
  return listExtensions(ses);
}
