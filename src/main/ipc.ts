import { ipcMain, BrowserWindow, Session, webContents, app } from "electron";
import { IPC, ChromeLayout, Settings, OverlayKind } from "../shared/types";
import { store } from "./settings";
import { TabManager } from "./tabs";
import { checkTor } from "./proxy";
import {
  getDownloads,
  openDownload,
  showDownload,
  clearDownloads,
  cancelDownload,
  pauseDownload,
  resumeDownload,
} from "./downloads";
import { tor } from "./tor";
import { veilSearch, veilVideos, veilNews, veilSuggest } from "./search";
import { veilAiChat } from "./ai";
import { history } from "./history";
import { bookmarks } from "./bookmarks";
import { AiMessage } from "../shared/types";

export interface OverlayCtl {
  show(kind: OverlayKind, anchorRight: number): void;
  showOmni(top: number): void;
  hide(): void;
  send(channel: string, payload: unknown): void;
}

import { getUpdate, downloadUpdate, applyUpdate, getStagedUpdate } from "./update";
import { getWelcomeContent } from "./welcome";
import { listExtensions, addExtension, removeExtension, installFromWebStore } from "./extensions";

export function registerIpc(win: BrowserWindow, tabs: TabManager, ses: Session, overlay: OverlayCtl) {
  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  // Broadcast to EVERY web contents (chrome UI + all internal veil:// tabs).
  // Web pages use the content preload and don't listen, so this is a no-op there.
  const broadcast = (channel: string, payload: unknown) => {
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed()) wc.send(channel, payload);
    }
  };

  // Push tab updates to the chrome UI; settings/stats broadcast to all pages
  // so theme + counters update live everywhere without a reload.
  tabs.on("updated", (state) => send(IPC.tabsUpdated, state));
  store.on("stats", (stats) => broadcast(IPC.statsUpdated, stats));
  store.on("settings", (settings) => broadcast(IPC.settingsUpdated, settings));

  // ---- Tabs ----
  ipcMain.handle(IPC.tabCreate, (_e, url?: string) => tabs.create(url));
  ipcMain.handle(IPC.tabClose, (_e, id: number) => tabs.close(id));
  ipcMain.handle(IPC.tabActivate, (_e, id: number) => tabs.activate(id));
  ipcMain.handle(IPC.tabReorder, (_e, orderIds: number[]) => tabs.reorder(orderIds));
  ipcMain.handle(IPC.tabPin, (_e, id: number) => tabs.togglePin(id));
  ipcMain.handle(IPC.tabRestore, () => tabs.restoreClosed());
  ipcMain.handle(IPC.tabTranslate, (_e, id?: number) => tabs.translate(id));

  // ---- Navigation ----
  ipcMain.handle(IPC.navGo, (_e, id: number, input: string) => tabs.load(id, input));
  ipcMain.handle(IPC.navBack, (_e, id?: number) => tabs.back(id));
  ipcMain.handle(IPC.navForward, (_e, id?: number) => tabs.forward(id));
  ipcMain.handle(IPC.navReload, (_e, id?: number) => tabs.reload(id));
  ipcMain.handle(IPC.navStop, (_e, id?: number) => tabs.stop(id));

  // ---- Layout ----
  ipcMain.handle(IPC.layoutSet, (_e, layout: ChromeLayout) => tabs.setLayout(layout));
  ipcMain.handle(IPC.contentHidden, (_e, hidden: boolean) => tabs.setContentHidden(hidden));

  // ---- Overlay (floating shields/menu panel) ----
  ipcMain.handle(IPC.overlayOpen, (_e, kind: OverlayKind, anchorRight: number) =>
    overlay.show(kind, anchorRight)
  );
  ipcMain.handle(IPC.overlayClose, () => overlay.hide());

  // ---- Omnibox dropdown (rendered in the overlay so it covers the page) ----
  ipcMain.handle(IPC.omniShow, (_e, items: unknown, sel: number, top: number) => {
    overlay.showOmni(top);
    overlay.send(IPC.omniData, { items, sel });
  });
  ipcMain.handle(IPC.omniHide, () => overlay.hide());
  ipcMain.handle(IPC.omniPick, (_e, value: string) => {
    overlay.hide();
    if (!win.isDestroyed()) win.webContents.send(IPC.omniPicked, value);
  });

  // ---- Zoom ----
  ipcMain.handle(IPC.zoom, (_e, dir: "in" | "out" | "reset") => tabs.zoom(dir));

  // ---- Downloads ----
  ipcMain.handle(IPC.downloadsGet, () => getDownloads());
  ipcMain.handle(IPC.downloadOpen, (_e, id: string) => openDownload(id));
  ipcMain.handle(IPC.downloadShow, (_e, id: string) => showDownload(id));
  ipcMain.handle(IPC.downloadsClear, () => clearDownloads());
  ipcMain.handle(IPC.downloadCancel, (_e, id: string) => cancelDownload(id));
  ipcMain.handle(IPC.downloadPause, (_e, id: string) => pauseDownload(id));
  ipcMain.handle(IPC.downloadResume, (_e, id: string) => resumeDownload(id));
  ipcMain.handle(IPC.downloadUrl, (_e, url: string) => ses.downloadURL(url));

  // ---- Settings ----
  ipcMain.handle(IPC.settingsGet, () => store.getSettings());
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => store.setSettings(patch));

  // ---- Stats ----
  ipcMain.handle(IPC.statsGet, () => store.getStats());
  ipcMain.handle(IPC.statsReset, () => store.resetStats());

  // ---- Veil Search ----
  ipcMain.handle(IPC.searchQuery, (_e, q: string, kind: string, offset = 0) =>
    kind === "videos" ? veilVideos(q)
      : kind === "news" ? veilNews(q)
      : kind === "suggest" ? veilSuggest(q)
      : veilSearch(q, offset)
  );

  // ---- Veil AI ----
  ipcMain.handle(IPC.aiChat, (_e, messages: AiMessage[]) => veilAiChat(messages));

  // ---- Window / app actions (menu) ----
  ipcMain.handle(IPC.winPrint, () => tabs.active?.view.webContents.print());
  ipcMain.handle(IPC.winFullscreen, () => win.setFullScreen(!win.isFullScreen()));
  ipcMain.handle(IPC.clearData, async () => {
    await ses.clearCache();
    await ses.clearStorageData();
    history.delete();
  });
  ipcMain.handle(IPC.quitApp, () => app.quit());

  // ---- Update ----
  ipcMain.handle(IPC.updateGet, () => getUpdate());
  ipcMain.handle(IPC.updateStaged, () => {
    const s = getStagedUpdate();
    return s ? { version: s.version } : null;
  });
  ipcMain.handle(IPC.updateDownload, async () => {
    try {
      return await downloadUpdate();
    } catch (e: any) {
      const msg = e?.message || "Update fehlgeschlagen";
      broadcast(IPC.updateProgress, { phase: "error", version: "", percent: 0, received: 0, total: 0, speed: 0, error: msg });
      throw e;
    }
  });
  ipcMain.handle(IPC.updateApply, () => applyUpdate());

  // ---- Welcome (first-run) ----
  ipcMain.handle(IPC.welcomeGet, () => getWelcomeContent());

  // ---- Extensions ----
  ipcMain.handle(IPC.extList, () => listExtensions(ses));
  ipcMain.handle(IPC.extLoad, () => addExtension(ses, win));
  ipcMain.handle(IPC.extInstallStore, (_e, input: string) => installFromWebStore(ses, input));
  ipcMain.handle(IPC.extRemove, (_e, id: string) => removeExtension(ses, id));

  // ---- App ----
  ipcMain.handle(IPC.appVersion, () => app.getVersion());

  // ---- Default browser ----
  ipcMain.handle(IPC.setDefaultBrowser, () => {
    const ok = ["http", "https"].map((p) => app.setAsDefaultProtocolClient(p));
    return ok.every(Boolean);
  });
  ipcMain.handle(IPC.isDefaultBrowser, () =>
    app.isDefaultProtocolClient("http") && app.isDefaultProtocolClient("https")
  );

  // ---- History ----
  // Broadcast so the open veil://history tab refreshes after deletes (not just
  // the chrome window).
  history.on("changed", () => broadcast(IPC.historyGet, history.all()));
  ipcMain.handle(IPC.historyGet, () => history.all());
  ipcMain.handle(IPC.historyDelete, (_e, urls: string[]) => history.delete(urls));
  ipcMain.handle(IPC.historyClear, () => history.delete());

  // ---- Bookmarks ----
  bookmarks.on("changed", () => broadcast(IPC.bookmarksUpdated, bookmarks.all()));
  ipcMain.handle(IPC.bookmarksGet, () => bookmarks.all());
  ipcMain.handle(IPC.bookmarkToggle, (_e, url: string, title: string) => bookmarks.toggle(url, title));
  ipcMain.handle(IPC.bookmarkRemove, (_e, url: string) => bookmarks.remove(url));

  // ---- Tor ----
  ipcMain.handle(IPC.torStatus, async () => {
    const s = store.getSettings();
    const status = tor.getStatus();
    // Refresh reachability live so the settings dot is accurate on open.
    const reachable = s.torEnabled ? await checkTor(s.torSocksPort) : false;
    return { ...status, enabled: s.torEnabled, reachable };
  });
}
