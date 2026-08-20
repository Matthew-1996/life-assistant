import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type LockedPackage = {
  resolved?: string;
};

describe("npm lockfile portability", () => {
  it("keeps every locked tarball on the public npm registry", async () => {
    const lock = JSON.parse(await readFile("package-lock.json", "utf8")) as {
      packages?: Record<string, LockedPackage>;
    };
    const nonPortable = Object.entries(lock.packages ?? {}).flatMap(
      ([packagePath, metadata]) => {
        if (!metadata.resolved) return [];
        const hostname = new URL(metadata.resolved).hostname;
        return hostname === "registry.npmjs.org"
          ? []
          : [{ hostname, packagePath }];
      },
    );

    expect(nonPortable).toEqual([]);
  });
});
