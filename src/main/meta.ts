import Store from "electron-store";

/**
 * Small persisted "meta" store for app-lifecycle flags that aren't user
 * settings: first-run welcome, and a staged (downloaded-but-not-applied) update.
 * Kept separate from the settings store so it never shows up in the UI.
 */
export interface StagedUpdate {
  version: string;
  dir: string; // folder that contains the new Veil.exe
}

interface Meta {
  launchedBefore: boolean;
  welcomedVersion: string; // last app version we showed a welcome/notice for
  staged: StagedUpdate | null;
}

export const meta = new Store<Meta>({
  name: "veil-meta",
  defaults: { launchedBefore: false, welcomedVersion: "", staged: null },
});
