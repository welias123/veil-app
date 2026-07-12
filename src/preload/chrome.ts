import { contextBridge, ipcRenderer } from "electron";
import {
  IPC, AiMessage, AiReply, BookmarkItem, ChromeLayout, DownloadItem, ExtensionInfo, HistoryEntry, NewsResult, OmniItem, OverlayContext, OverlayKind, SearchKind, SearchResult, Settings, StagedUpdateInfo, Stats, TabState, TorRuntimeStatus, UpdateInfo, UpdateProgress, VideoResult, WelcomeContent,
} from "../shared/types";

/**
 * Privileged bridge exposed ONLY to the chrome UI window (file://) and internal
 * veil:// pages. The unified preload gates this behind an origin check so
 * arbitrary web content never sees it.
 */
export function exposeVeilApi() {
  const api = {
  // Tabs
  createTab: (url?: string): Promise<number> => ipcRenderer.invoke(IPC.tabCreate, url),
  closeTab: (id: number) => ipcRenderer.invoke(IPC.tabClose, id),
  activateTab: (id: number) => ipcRenderer.invoke(IPC.tabActivate, id),
  reorderTabs: (orderIds: number[]) => ipcRenderer.invoke(IPC.tabReorder, orderIds),
  pinTab: (id: number) => ipcRenderer.invoke(IPC.tabPin, id),
  restoreTab: () => ipcRenderer.invoke(IPC.tabRestore),
  translatePage: (id?: number) => ipcRenderer.invoke(IPC.tabTranslate, id),

  // Navigation
  go: (id: number, input: string) => ipcRenderer.invoke(IPC.navGo, id, input),
  back: (id?: number) => ipcRenderer.invoke(IPC.navBack, id),
  forward: (id?: number) => ipcRenderer.invoke(IPC.navForward, id),
  reload: (id?: number) => ipcRenderer.invoke(IPC.navReload, id),
  stop: (id?: number) => ipcRenderer.invoke(IPC.navStop, id),

  // Layout
  setLayout: (layout: ChromeLayout) => ipcRenderer.invoke(IPC.layoutSet, layout),
  setContentHidden: (hidden: boolean) => ipcRenderer.invoke(IPC.contentHidden, hidden),

  // Overlay (floating shields/menu panel)
  openOverlay: (kind: OverlayKind, anchorRight: number) =>
    ipcRenderer.invoke(IPC.overlayOpen, kind, anchorRight),
  closeOverlay: () => ipcRenderer.invoke(IPC.overlayClose),
  onOverlayShow: (cb: (ctx: OverlayContext) => void) =>
    ipcRenderer.on(IPC.overlayShow, (_e, ctx) => cb(ctx)),

  // Omnibox dropdown
  omniShow: (items: OmniItem[], sel: number, top: number) =>
    ipcRenderer.invoke(IPC.omniShow, items, sel, top),
  omniHide: () => ipcRenderer.invoke(IPC.omniHide),
  omniPick: (value: string) => ipcRenderer.invoke(IPC.omniPick, value),
  onOmniData: (cb: (d: { items: OmniItem[]; sel: number }) => void) =>
    ipcRenderer.on(IPC.omniData, (_e, d) => cb(d)),
  onOmniPicked: (cb: (value: string) => void) =>
    ipcRenderer.on(IPC.omniPicked, (_e, v) => cb(v)),

  // Settings
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),

  // Stats
  getStats: (): Promise<Stats> => ipcRenderer.invoke(IPC.statsGet),
  resetStats: (): Promise<Stats> => ipcRenderer.invoke(IPC.statsReset),

  // Veil Search
  search: (q: string, kind: SearchKind = "web", offset = 0): Promise<SearchResult[] | VideoResult[] | NewsResult[]> =>
    ipcRenderer.invoke(IPC.searchQuery, q, kind, offset),
  suggest: (q: string): Promise<string[]> => ipcRenderer.invoke(IPC.searchQuery, q, "suggest"),

  // Veil AI
  aiChat: (messages: AiMessage[]): Promise<AiReply> => ipcRenderer.invoke(IPC.aiChat, messages),

  // System
  setDefaultBrowser: (): Promise<boolean> => ipcRenderer.invoke(IPC.setDefaultBrowser),
  isDefaultBrowser: (): Promise<boolean> => ipcRenderer.invoke(IPC.isDefaultBrowser),
  print: () => ipcRenderer.invoke(IPC.winPrint),
  toggleFullscreen: () => ipcRenderer.invoke(IPC.winFullscreen),
  clearData: () => ipcRenderer.invoke(IPC.clearData),
  quit: () => ipcRenderer.invoke(IPC.quitApp),

  // Update
  getUpdate: (): Promise<UpdateInfo | null> => ipcRenderer.invoke(IPC.updateGet),
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) =>
    ipcRenderer.on(IPC.updateAvailable, (_e, info) => cb(info)),
  getStagedUpdate: (): Promise<StagedUpdateInfo | null> => ipcRenderer.invoke(IPC.updateStaged),
  downloadUpdate: (): Promise<string> => ipcRenderer.invoke(IPC.updateDownload),
  applyUpdate: (): Promise<boolean> => ipcRenderer.invoke(IPC.updateApply),
  onUpdateProgress: (cb: (p: UpdateProgress) => void) =>
    ipcRenderer.on(IPC.updateProgress, (_e, p) => cb(p)),
  getWelcome: (): Promise<WelcomeContent> => ipcRenderer.invoke(IPC.welcomeGet),
  listExtensions: (): Promise<ExtensionInfo[]> => ipcRenderer.invoke(IPC.extList),
  loadExtension: (): Promise<ExtensionInfo[]> => ipcRenderer.invoke(IPC.extLoad),
  installStoreExtension: (input: string): Promise<ExtensionInfo[]> => ipcRenderer.invoke(IPC.extInstallStore, input),
  removeExtension: (id: string): Promise<ExtensionInfo[]> => ipcRenderer.invoke(IPC.extRemove, id),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  platform: process.platform,

  // History
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke(IPC.historyGet),
  deleteHistory: (urls: string[]) => ipcRenderer.invoke(IPC.historyDelete, urls),
  clearHistory: () => ipcRenderer.invoke(IPC.historyClear),
  onHistory: (cb: (list: HistoryEntry[]) => void) =>
    ipcRenderer.on(IPC.historyGet, (_e, list) => cb(list)),

  // Bookmarks
  getBookmarks: (): Promise<BookmarkItem[]> => ipcRenderer.invoke(IPC.bookmarksGet),
  toggleBookmark: (url: string, title: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.bookmarkToggle, url, title),
  removeBookmark: (url: string) => ipcRenderer.invoke(IPC.bookmarkRemove, url),
  onBookmarks: (cb: (list: BookmarkItem[]) => void) =>
    ipcRenderer.on(IPC.bookmarksUpdated, (_e, list) => cb(list)),

  // Tor
  torStatus: (): Promise<TorRuntimeStatus> => ipcRenderer.invoke(IPC.torStatus),
  onTorStatus: (cb: (s: TorRuntimeStatus) => void) =>
    ipcRenderer.on(IPC.torStatusUpdated, (_e, s) => cb(s)),

  // Zoom
  zoom: (dir: "in" | "out" | "reset") => ipcRenderer.invoke(IPC.zoom, dir),

  // Downloads
  getDownloads: (): Promise<DownloadItem[]> => ipcRenderer.invoke(IPC.downloadsGet),
  openDownload: (id: string) => ipcRenderer.invoke(IPC.downloadOpen, id),
  showDownload: (id: string) => ipcRenderer.invoke(IPC.downloadShow, id),
  clearDownloads: () => ipcRenderer.invoke(IPC.downloadsClear),
  cancelDownload: (id: string) => ipcRenderer.invoke(IPC.downloadCancel, id),
  pauseDownload: (id: string) => ipcRenderer.invoke(IPC.downloadPause, id),
  resumeDownload: (id: string) => ipcRenderer.invoke(IPC.downloadResume, id),
  downloadUrl: (url: string) => ipcRenderer.invoke(IPC.downloadUrl, url),
  onDownloads: (cb: (list: DownloadItem[]) => void) =>
    ipcRenderer.on(IPC.downloadsUpdated, (_e, list) => cb(list)),

  // Events (main -> renderer)
  onTabs: (cb: (tabs: TabState[]) => void) =>
    ipcRenderer.on(IPC.tabsUpdated, (_e, tabs) => cb(tabs)),
  onStats: (cb: (stats: Stats) => void) =>
    ipcRenderer.on(IPC.statsUpdated, (_e, stats) => cb(stats)),
  onSettings: (cb: (settings: Settings) => void) =>
    ipcRenderer.on(IPC.settingsUpdated, (_e, s) => cb(s)),
  openSettings: (cb: () => void) => ipcRenderer.on(IPC.openSettings, () => cb()),
  onShortcut: (cb: (s: { key: string; control: boolean; shift: boolean; alt: boolean }) => void) =>
    ipcRenderer.on(IPC.shortcut, (_e, s) => cb(s)),
  };

  contextBridge.exposeInMainWorld("veil", api);
}
