import Store from "electron-store";
import { EventEmitter } from "node:events";
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  Settings,
  Stats,
} from "../shared/types";

/**
 * Central persisted state. Emits "settings" and "stats" whenever the
 * respective slice changes so other subsystems can react live.
 */
class VeilStore extends EventEmitter {
  private store = new Store<{ settings: Settings; stats: Stats }>({
    name: "veil",
    defaults: { settings: DEFAULT_SETTINGS, stats: DEFAULT_STATS },
  });

  getSettings(): Settings {
    // Merge with defaults so new keys added in updates are always present.
    return { ...DEFAULT_SETTINGS, ...this.store.get("settings") };
  }

  setSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch };
    this.store.set("settings", next);
    this.emit("settings", next);
    return next;
  }

  getStats(): Stats {
    return { ...DEFAULT_STATS, ...this.store.get("stats") };
  }

  /** Increment stats counters atomically and notify listeners. */
  bumpStats(delta: Partial<Stats>): Stats {
    const cur = this.getStats();
    const next: Stats = {
      trackersBlocked: cur.trackersBlocked + (delta.trackersBlocked ?? 0),
      adsBlocked: cur.adsBlocked + (delta.adsBlocked ?? 0),
      bytesSaved: cur.bytesSaved + (delta.bytesSaved ?? 0),
      requestsBlocked: cur.requestsBlocked + (delta.requestsBlocked ?? 0),
    };
    this.store.set("stats", next);
    this.emit("stats", next);
    return next;
  }

  resetStats(): Stats {
    this.store.set("stats", DEFAULT_STATS);
    this.emit("stats", DEFAULT_STATS);
    return DEFAULT_STATS;
  }
}

export const store = new VeilStore();
