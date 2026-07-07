import { app } from "electron";
import { EventEmitter } from "node:events";
import { spawn, ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import fetch from "cross-fetch";
import { Settings, TorPhase, TorRuntimeStatus } from "../shared/types";
import { checkTor } from "./proxy";

const execFileP = promisify(execFile);
const log = (...a: unknown[]) => console.log("[veil:tor]", ...a);

/**
 * Bundled Tor. On first enable we download the official Tor Expert Bundle
 * (Windows x86_64) into the app's data dir, then spawn `tor.exe` and route
 * .onion traffic to its SOCKS port. If a Tor daemon is already listening on the
 * configured port (e.g. the user runs their own), we reuse it and skip all this.
 *
 * Only .onion is routed through Tor by default, so normal browsing is unaffected
 * and stays at full speed.
 */

// Pinned fallback versions (newest first) — all verified to exist on the
// official archive. We also try to discover a newer one at runtime.
const FALLBACK_VERSIONS = ["14.5.7", "14.5.6", "14.0.9"];
const ARCHIVE = "https://archive.torproject.org/tor-package-archive/torbrowser";

function bundleUrl(v: string): string {
  return `${ARCHIVE}/${v}/tor-expert-bundle-windows-x86_64-${v}.tar.gz`;
}

class TorManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private status: TorRuntimeStatus = {
    enabled: false,
    reachable: false,
    phase: "off",
    progress: 0,
    message: "Tor deaktiviert",
  };

  private get root() {
    return path.join(app.getPath("userData"), "tor");
  }
  private get torExe() {
    return path.join(this.root, "tor", "tor.exe");
  }
  private get dataDir() {
    return path.join(this.root, "tordata");
  }

  getStatus(): TorRuntimeStatus {
    return this.status;
  }

  private set(phase: TorPhase, message: string, progress = this.status.progress, extra: Partial<TorRuntimeStatus> = {}) {
    this.status = { ...this.status, phase, message, progress, ...extra };
    this.emit("status", this.status);
  }

  /** Reconcile Tor with the desired settings (called on start + settings change). */
  async apply(settings: Settings) {
    if (!settings.torEnabled) {
      this.stop();
      this.set("off", "Tor deaktiviert", 0, { enabled: false, reachable: false });
      return;
    }
    this.status.enabled = true;
    const port = settings.torSocksPort;

    // Already reachable (our own process or a user-run daemon)?
    if (await checkTor(port)) {
      this.set("ready", "Tor-Netzwerk verbunden", 100, { reachable: true });
      return;
    }

    try {
      await this.ensureBinary();
      await this.spawnTor(port);
    } catch (err: any) {
      this.set("error", `Tor-Fehler: ${err?.message ?? err}`, this.status.progress, { reachable: false });
    }
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        /* ignore */
      }
      this.proc = null;
    }
  }

  // ---- Binary provisioning ----
  private async ensureBinary() {
    if (fs.existsSync(this.torExe)) {
      log("binary already present:", this.torExe);
      return;
    }
    await fsp.mkdir(this.root, { recursive: true });

    const version = await this.discoverVersion();
    const url = bundleUrl(version);
    log("downloading", url);
    this.set("downloading", `Lade Tor ${version}…`, 0);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const archivePath = path.join(this.root, "tor-bundle.tar.gz");
    await fsp.writeFile(archivePath, buf);
    log("downloaded", buf.length, "bytes → extracting");

    this.set("downloading", "Entpacke Tor…", 100);
    // Windows 10+ ships bsdtar as `tar` in System32, which handles .tar.gz.
    const tarExe = process.platform === "win32"
      ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
      : "tar";
    try {
      const { stderr } = await execFileP(tarExe, ["-xzf", archivePath, "-C", this.root]);
      if (stderr) log("tar stderr:", stderr);
    } catch (err: any) {
      log("tar failed:", err?.message);
      throw new Error(`Entpacken fehlgeschlagen: ${err?.message ?? err}`);
    }
    await fsp.rm(archivePath, { force: true });

    if (!fs.existsSync(this.torExe)) {
      throw new Error("tor.exe nach dem Entpacken nicht gefunden");
    }
    log("extracted, tor.exe at", this.torExe);
  }

  /** Try to find the newest available version; fall back to pinned list. */
  private async discoverVersion(): Promise<string> {
    try {
      const res = await fetch(`${ARCHIVE}/`);
      const html = await res.text();
      const versions = [...html.matchAll(/href="(\d+\.\d+(?:\.\d+)?)\/"/g)].map((m) => m[1]);
      // Prefer the highest version that has a windows expert bundle.
      versions.sort(cmpVersion);
      for (const v of versions.reverse()) {
        const head = await fetch(bundleUrl(v), { method: "HEAD" });
        if (head.ok) return v;
      }
    } catch {
      /* offline or listing changed — use fallback */
    }
    return FALLBACK_VERSIONS[0];
  }

  // ---- Process ----
  private spawnTor(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const geoip = path.join(this.root, "data", "geoip");
      const geoip6 = path.join(this.root, "data", "geoip6");
      const args = [
        "--SocksPort", String(port),
        "--DataDirectory", this.dataDir,
        "--ClientOnly", "1",
        "--ignore-missing-torrc", // run from CLI args only, no torrc needed
        "-f", path.join(this.dataDir, "torrc"),
      ];
      if (fs.existsSync(geoip)) args.push("--GeoIPFile", geoip);
      if (fs.existsSync(geoip6)) args.push("--GeoIPv6File", geoip6);

      fs.mkdirSync(this.dataDir, { recursive: true });
      this.set("starting", "Starte Tor…", 0);
      log("spawning", this.torExe, args.join(" "));
      const proc = spawn(this.torExe, args, { cwd: path.dirname(this.torExe) });
      this.proc = proc;
      let settled = false;

      const onLine = (line: string) => {
        if (line.trim()) log("tor:", line.trim());
        const m = line.match(/Bootstrapped (\d+)%/);
        if (m) {
          const pct = parseInt(m[1]);
          this.set("bootstrapping", `Verbinde mit Tor… ${pct}%`, pct);
          if (pct >= 100 && !settled) {
            settled = true;
            this.set("ready", "Tor-Netzwerk verbunden", 100, { reachable: true });
            resolve();
          }
        }
      };

      proc.stdout?.on("data", (d) => String(d).split(/\r?\n/).forEach(onLine));
      proc.stderr?.on("data", (d) => String(d).split(/\r?\n/).forEach(onLine));
      proc.on("error", (err) => {
        log("spawn error:", err.message);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      proc.on("exit", (code) => {
        log("tor exited, code", code);
        this.proc = null;
        if (this.status.phase !== "off" && this.status.phase !== "ready") {
          this.set("error", `Tor beendet (Code ${code})`, this.status.progress, { reachable: false });
        }
      });

      // Safety timeout: bootstrap shouldn't take longer than ~90s.
      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Zeitüberschreitung beim Verbinden"));
        }
      }, 90_000);
    });
  }
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export const tor = new TorManager();
