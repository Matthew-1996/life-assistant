import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "cheerio";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(suiteDirectory, "../..");
const publicDirectory = resolve(appRoot, "public");
const manifestPath = resolve(publicDirectory, "manifest.webmanifest");
const temporaryDirectories: string[] = [];

interface InstallationManifest {
  background_color: string;
  display: string;
  icons: Array<{
    sizes: string;
    src: string;
    type: string;
  }>;
  id: string;
  name: string;
  scope: string;
  short_name: string;
  start_url: string;
  theme_color: string;
}

function readManifest(): InstallationManifest | null {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8")) as InstallationManifest;
}

function pngProperties(path: string): {
  hasAlpha: boolean;
  height: number;
  width: number;
} {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  return {
    hasAlpha: bytes[25] === 4 || bytes[25] === 6,
    height: bytes.readUInt32BE(20),
    width: bytes.readUInt32BE(16),
  };
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory()
      ? listFiles(path)
      : [relative(directory, path)];
  });
}

function readTextOutput(directory: string): string {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = resolve(directory, name);
      if (statSync(path).isDirectory()) return [readTextOutput(path)];
      return /\.(?:css|html|js|json|webmanifest)$/u.test(name)
        ? [readFileSync(path, "utf8")]
        : [];
    })
    .join("\n");
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true });
  });
});

describe("iOS home-screen installation", () => {
  it("declares an iOS standalone home-screen app", () => {
    const index = readFileSync(resolve(appRoot, "index.html"), "utf8");
    const $ = load(index);

    expect($("link[rel='manifest']").attr("href")).toBe(
      "/manifest.webmanifest",
    );
    expect($("link[rel='apple-touch-icon']").attr("href")).toBe(
      "/apple-touch-icon.png",
    );
    expect($("link[rel='apple-touch-icon']").attr("sizes")).toBe("180x180");
    expect(
      $("meta[name='apple-mobile-web-app-capable']").attr("content"),
    ).toBe("yes");
    expect(
      $("meta[name='apple-mobile-web-app-title']").attr("content"),
    ).toBe("Life Console");
    expect(
      $("meta[name='apple-mobile-web-app-status-bar-style']").attr("content"),
    ).toBe("default");
    expect($("meta[name='theme-color']").attr("content")).toBe("#f5f5f7");

    const manifest = readManifest();
    expect(manifest, "manifest.webmanifest must exist").not.toBeNull();
    expect(manifest).toMatchObject({
      background_color: "#f5f5f7",
      display: "standalone",
      id: "/",
      name: "Life Console",
      scope: "/",
      short_name: "Life Console",
      start_url: "/",
      theme_color: "#f5f5f7",
    });
  });

  it("lets the iOS layout consume the full safe-area viewport", () => {
    const index = readFileSync(resolve(appRoot, "index.html"), "utf8");
    const $ = load(index);
    const viewport = $("meta[name='viewport']").attr("content") ?? "";

    expect(viewport.split(",").map((value) => value.trim())).toContain(
      "viewport-fit=cover",
    );
  });

  it("ships the declared iOS PNG icons at their exact sizes", () => {
    const manifest = readManifest();
    expect(manifest, "manifest.webmanifest must exist").not.toBeNull();
    if (!manifest) return;

    expect(manifest.icons).toEqual([
      {
        sizes: "180x180",
        src: "/apple-touch-icon.png",
        type: "image/png",
      },
      {
        sizes: "512x512",
        src: "/life-console-icon-512.png",
        type: "image/png",
      },
    ]);

    for (const icon of manifest.icons) {
      const path = resolve(publicDirectory, icon.src.replace(/^\//u, ""));
      expect(existsSync(path), `${icon.src} must exist`).toBe(true);
      expect(pngProperties(path)).toEqual({
        hasAlpha: false,
        height: Number.parseInt(icon.sizes.split("x")[1], 10),
        width: Number.parseInt(icon.sizes.split("x")[0], 10),
      });
    }
  });

  it("ships the approved installation-only Production boundary", async () => {
    const outputDirectory = mkdtempSync(
      resolve(tmpdir(), "life-console-ios-installation-"),
    );
    temporaryDirectories.push(outputDirectory);

    await build({
      build: { emptyOutDir: true, outDir: outputDirectory },
      configFile: resolve(appRoot, "vite.config.ts"),
      logLevel: "silent",
      mode: "supabase-production",
      root: appRoot,
    });

    const files = listFiles(outputDirectory);
    expect(files).toContain("manifest.webmanifest");
    expect(files).toContain("apple-touch-icon.png");
    expect(files).toContain("life-console-icon-512.png");
    expect(
      files.filter((name) =>
        /(?:^|\/)(?:sw(?:\.[^/]*)?\.js|service-worker[^/]*\.js|workbox[^/]*)$/iu
          .test(name)
      ),
    ).toEqual([]);

    const output = readTextOutput(outputDirectory);
    expect(output).not.toContain("serviceWorker.register");
    expect(output).not.toContain("workbox");
  }, 15_000);
});
