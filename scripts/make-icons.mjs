import sharp from "sharp";
import pngToIco from "png-to-ico";
import { mkdir, writeFile, readFile } from "node:fs/promises";

// Rasterize the vector logo into the raster formats electron-builder needs.
await mkdir("build", { recursive: true });
const svg = await readFile("icon.svg");

// High-res master PNG (used by electron-builder to derive sizes).
await sharp(svg, { density: 384 }).resize(1024, 1024).png().toFile("build/icon.png");

// Windows .ico from a set of standard sizes.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(
  sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
);
await writeFile("build/icon.ico", await pngToIco(pngs));

console.log("[veil] icons written: build/icon.png, build/icon.ico");
