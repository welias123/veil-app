import Store from "electron-store";
import { EventEmitter } from "node:events";
import { HistoryEntry } from "../shared/types";

/** Browsing history, persisted and de-duplicated (most recent first). */
class History extends EventEmitter {
  private store = new Store<{ entries: HistoryEntry[] }>({ name: "veil-history", defaults: { entries: [] } });

  all(): HistoryEntry[] {
    return this.store.get("entries");
  }

  add(url: string, title: string) {
    if (!/^https?:\/\//i.test(url)) return; // skip internal / non-web pages
    const entries = this.all().filter((e) => e.url !== url);
    entries.unshift({ url, title: title || url, time: Date.now() });
    this.store.set("entries", entries.slice(0, 1000));
    this.emit("changed");
  }

  /** Delete specific URLs, or everything when no list is given. */
  delete(urls?: string[]) {
    if (!urls || !urls.length) {
      this.store.set("entries", []);
    } else {
      const set = new Set(urls);
      this.store.set("entries", this.all().filter((e) => !set.has(e.url)));
    }
    this.emit("changed");
  }
}

export const history = new History();
