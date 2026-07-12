import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const watch = process.argv.includes("--watch");
const outdir = "dist";

/** Shared esbuild options. */
const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
};

// Main + preload run in Node/Electron context; Electron is external (provided at runtime).
const mainConfigs = [
  {
    ...common,
    entryPoints: ["src/main/index.ts"],
    outfile: `${outdir}/main/index.js`,
    // The adblocker resolves its preload path at runtime via
    // createRequire(import.meta.url); bundling breaks that, so keep it external
    // and let Node load its CommonJS build from node_modules.
    external: ["electron", "electron-store", "electron-updater", "@ghostery/adblocker-electron"],
  },
  {
    ...common,
    entryPoints: ["src/preload/index.ts"],
    outfile: `${outdir}/preload/index.js`,
    external: ["electron"],
  },
];

// Renderer scripts run in a browser-like context.
const rendererConfigs = [
  {
    ...common,
    platform: "browser",
    target: "es2022",
    entryPoints: [
      "src/renderer/chrome.ts",
      "src/renderer/newtab.ts",
      "src/renderer/settings.ts",
      "src/renderer/overlay.ts",
      "src/renderer/search.ts",
      "src/renderer/connecting.ts",
      "src/renderer/history.ts",
    ],
    outdir: `${outdir}/renderer`,
  },
];

async function copyStatic() {
  await mkdir(`${outdir}/renderer`, { recursive: true });
  const files = ["index.html", "newtab.html", "settings.html", "overlay.html", "error.html", "search.html", "connecting.html", "history.html"];
  for (const f of files) {
    await cp(`src/renderer/${f}`, `${outdir}/renderer/${f}`);
  }
  if (existsSync("icon.svg")) await cp("icon.svg", `${outdir}/renderer/icon.svg`);
}

function runTailwind() {
  return new Promise((resolve) => {
    const args = [
      "tailwindcss",
      "-i",
      "src/renderer/styles.css",
      "-o",
      `${outdir}/renderer/styles.css`,
      "--minify",
    ];
    if (watch) args.push("--watch");
    const p = spawn("npx", args, { stdio: "inherit", shell: true });
    if (watch) resolve(); // don't block in watch mode
    else p.on("close", () => resolve());
  });
}

async function main() {
  await rm(outdir, { recursive: true, force: true });
  await copyStatic();

  const configs = [...mainConfigs, ...rendererConfigs];

  if (watch) {
    for (const c of configs) {
      const ctx = await context(c);
      await ctx.watch();
    }
    runTailwind();
    console.log("[veil] watching for changes…");
  } else {
    await Promise.all(configs.map((c) => build(c)));
    await runTailwind();
    console.log("[veil] build complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
