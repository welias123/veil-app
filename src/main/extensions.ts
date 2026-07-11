import { BrowserWindow, dialog, Session } from "electron";
import fs from "node:fs";
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
