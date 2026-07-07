import Store from "electron-store";
import { EventEmitter } from "node:events";
import { BookmarkItem } from "../shared/types";

/** Bookmarks / favorites, persisted, most-recent first. */
class Bookmarks extends EventEmitter {
  private store = new Store<{ items: BookmarkItem[] }>({ name: "veil-bookmarks", defaults: { items: [] } });

  all(): BookmarkItem[] {
    return this.store.get("items");
  }
  has(url: string): boolean {
    return this.all().some((b) => b.url === url);
  }
  remove(url: string) {
    this.store.set("items", this.all().filter((b) => b.url !== url));
    this.emit("changed");
  }
  /** Add or remove; returns the new bookmarked state. */
  toggle(url: string, title: string): boolean {
    if (!/^https?:\/\//i.test(url)) return false;
    if (this.has(url)) {
      this.remove(url);
      return false;
    }
    this.store.set("items", [{ url, title: title || url, time: Date.now() }, ...this.all()].slice(0, 500));
    this.emit("changed");
    return true;
  }
}

export const bookmarks = new Bookmarks();
