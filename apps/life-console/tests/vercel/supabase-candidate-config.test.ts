// @vitest-environment node

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  candidateContentSecurityPolicy,
  createLifeConsoleVercelConfig,
  createSupabaseCandidateVercelConfig,
  createSupabaseProductionVercelConfig,
} from "../../scripts/supabase-candidate-config.mjs";

const syntheticEnvironment = {
  VERCEL_ENV: "preview",
  VITE_SUPABASE_URL: "https://synthetic-project.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_only",
};

const syntheticProductionEnvironment = {
  ...syntheticEnvironment,
  VERCEL_ENV: "production",
  VERCEL_PROJECT_NAME: "life-console-production",
  VERCEL_PROJECT_PRODUCTION_URL: "project-wpabq.vercel.app",
};

function createGeneratorFixture() {
  const root = mkdtempSync(join(tmpdir(), "life-console-vercel-config-"));
  mkdirSync(resolve(root, "scripts"));
  copyFileSync(
    resolve(process.cwd(), "scripts/write-vercel-config.mjs"),
    resolve(root, "scripts/write-vercel-config.mjs"),
  );
  copyFileSync(
    resolve(process.cwd(), "scripts/supabase-candidate-config.mjs"),
    resolve(root, "scripts/supabase-candidate-config.mjs"),
  );
  return root;
}

function runGenerator(root: string, outputPath: string) {
  return spawnSync(
    process.execPath,
    ["scripts/write-vercel-config.mjs", "--write", outputPath],
    {
      cwd: root,
      encoding: "utf8",
      env: syntheticProductionEnvironment,
    },
  );
}

describe("Supabase candidate Vercel configuration", () => {
  it("allows only the exact synthetic HTTPS and WSS origins", () => {
    const csp = candidateContentSecurityPolicy(syntheticEnvironment);
    expect(csp).toContain(
      "connect-src 'self' https://synthetic-project.supabase.co wss://synthetic-project.supabase.co",
    );
    expect(csp).not.toContain("*.supabase.co");
    expect(csp).not.toContain("sb_publishable_");
  });

  it("builds only the isolated Supabase candidate Preview", () => {
    const config = createSupabaseCandidateVercelConfig(syntheticEnvironment);
    expect(config.buildCommand).toBe("npm run build:supabase-candidate");
    expect(config.outputDirectory).toBe("dist/supabase-candidate");
    expect(JSON.stringify(config)).not.toContain("service_role");
    expect(JSON.stringify(config)).not.toContain("sb_secret_");
  });

  it("accepts legacy JWT anon keys (eyJ-prefixed)", () => {
    const legacyEnv = {
      ...syntheticEnvironment,
      VITE_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic.payload",
    };
    const config = createSupabaseCandidateVercelConfig(legacyEnv);
    expect(config.buildCommand).toBe("npm run build:supabase-candidate");
  });

  it("fails closed for missing, malformed, secret, or Production input", () => {
    expect(() => createSupabaseCandidateVercelConfig({})).toThrow();
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_URL: "https://example.com",
    })).toThrow(/exact HTTPS Supabase project origin/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_URL: "https://nested.synthetic-project.supabase.co",
    })).toThrow(/exact HTTPS Supabase project origin/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_URL: "https://synthetic-project.supabase.co:8443",
    })).toThrow(/exact HTTPS Supabase project origin/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden",
    })).toThrow(/secret key/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VITE_SUPABASE_PUBLISHABLE_KEY: "invalid_format_key",
    })).toThrow(/publishable key or legacy anon JWT/);
    expect(() => createSupabaseCandidateVercelConfig({
      ...syntheticEnvironment,
      VERCEL_ENV: "production",
    })).toThrow(/Preview/);
  });
});

describe("Supabase Production Vercel configuration", () => {
  it("builds the isolated Production project with the candidate security policy", () => {
    const config = createSupabaseProductionVercelConfig(
      syntheticProductionEnvironment,
    );

    expect(config.buildCommand).toBe("npm run build:supabase-production");
    expect(config.outputDirectory).toBe("dist/supabase-production");
    expect(config.rewrites).toEqual([
      { source: "/auth/recovery", destination: "/index.html" },
    ]);
    expect(config.headers).toEqual(
      createSupabaseCandidateVercelConfig(syntheticEnvironment).headers,
    );
  });

  it("fails closed outside the exact independent Production project", () => {
    expect(() => createSupabaseProductionVercelConfig({
      ...syntheticProductionEnvironment,
      VERCEL_ENV: "preview",
    })).toThrow(/Production/);
    expect(() => createSupabaseProductionVercelConfig({
      ...syntheticProductionEnvironment,
      VERCEL_PROJECT_PRODUCTION_URL: "other-project.vercel.app",
    })).toThrow(/life-console-production/);
    expect(() => createSupabaseProductionVercelConfig({
      ...syntheticProductionEnvironment,
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_forbidden",
    })).toThrow(/only VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY/);
    expect(() => createSupabaseProductionVercelConfig({
      ...syntheticProductionEnvironment,
      SUPABASE_SERVICE_ROLE_KEY: "",
    })).toThrow(/only VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY/);
    expect(() => createSupabaseProductionVercelConfig({
      ...syntheticProductionEnvironment,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden",
    })).toThrow(/secret key/);
  });

  it("rejects missing Production project-name metadata", () => {
    const {
      VERCEL_PROJECT_NAME: _projectName,
      ...environmentWithoutProjectName
    } = syntheticProductionEnvironment;

    expect(() => createSupabaseProductionVercelConfig(
      environmentWithoutProjectName,
    )).toThrow(/life-console-production/);
  });

  it("rejects the wrong Production project-name metadata", () => {
    expect(() => createSupabaseProductionVercelConfig({
      ...syntheticProductionEnvironment,
      VERCEL_PROJECT_NAME: "other-project",
    })).toThrow(/life-console-production/);
  });

  it("routes Preview and Production through separate config entries", () => {
    expect(createLifeConsoleVercelConfig(syntheticEnvironment)).toEqual(
      createSupabaseCandidateVercelConfig(syntheticEnvironment),
    );
    expect(createLifeConsoleVercelConfig(syntheticProductionEnvironment)).toEqual(
      createSupabaseProductionVercelConfig(syntheticProductionEnvironment),
    );
  });
});

describe("Vercel deployment artifact generation", () => {
  it("avoids the reserved dynamic-config entrypoint while keeping the generator runnable", () => {
    expect(existsSync(resolve(process.cwd(), "vercel.mjs"))).toBe(false);

    const root = mkdtempSync(join(tmpdir(), "life-console-vercel-entrypoint-"));
    const outputPath = resolve(root, ".vercel/life-console.production.json");
    const result = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "scripts/write-vercel-config.mjs"),
        "--write",
        ".vercel/life-console.production.json",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: syntheticProductionEnvironment,
      },
    );

    try {
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
        buildCommand: "npm run build:supabase-production",
        outputDirectory: "dist/supabase-production",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps generator imports side-effect-free", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "await import('./scripts/write-vercel-config.mjs')",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {},
      },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("writes valid JSON without embedding the publishable key or a secret", () => {
    const root = createGeneratorFixture();
    const outputPath = resolve(root, ".vercel/life-console.production.json");
    const environmentPath = resolve(root, ".synthetic-production.env");
    const publishableKey = "sb_publishable_must_not_be_serialized";

    try {
      writeFileSync(
        environmentPath,
        [
          "# Created by Vercel CLI",
          'VERCEL_ENV="production"',
          'VERCEL_PROJECT_NAME="life-console-production"',
          'VERCEL_PROJECT_PRODUCTION_URL="project-wpabq.vercel.app"',
          'VITE_SUPABASE_URL="https://synthetic-project.supabase.co"',
          `VITE_SUPABASE_PUBLISHABLE_KEY="${publishableKey}"`,
          "",
        ].join("\n"),
        { encoding: "utf8", mode: 0o600 },
      );
      execFileSync(
        process.execPath,
        [
          `--env-file=${environmentPath}`,
          "scripts/write-vercel-config.mjs",
          "--write",
          ".vercel/life-console.production.json",
        ],
        {
          cwd: root,
          env: {},
        },
      );

      const artifact = readFileSync(outputPath, "utf8");
      const parsed = JSON.parse(artifact);
      expect(parsed.buildCommand).toBe("npm run build:supabase-production");
      expect(parsed.outputDirectory).toBe("dist/supabase-production");
      expect(parsed.rewrites).toEqual([
        { source: "/auth/recovery", destination: "/index.html" },
      ]);
      expect(parsed.headers).toEqual(
        createSupabaseProductionVercelConfig({
          ...syntheticProductionEnvironment,
          VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        }).headers,
      );
      expect(artifact).not.toContain(publishableKey);
      expect(artifact).not.toContain("sb_secret_");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects every alternate output filename or path", () => {
    const root = createGeneratorFixture();
    try {
      for (const outputPath of [
        ".vercel/production.json",
        ".vercel/nested/life-console.production.json",
        "life-console.production.json",
      ]) {
        const result = runGenerator(root, outputPath);
        expect(result.status, outputPath).not.toBe(0);
        expect(result.stderr).toContain(
          "Output path must be .vercel/life-console.production.json",
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports CLI usage with the one allowed output path", () => {
    const root = createGeneratorFixture();
    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/write-vercel-config.mjs", "--write"],
        {
        cwd: root,
        encoding: "utf8",
        env: syntheticProductionEnvironment,
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Usage: node scripts/write-vercel-config.mjs --write .vercel/life-console.production.json",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked .vercel parent without writing through it", () => {
    const root = createGeneratorFixture();
    const redirectedDirectory = resolve(root, "redirected");
    mkdirSync(redirectedDirectory);
    symlinkSync(redirectedDirectory, resolve(root, ".vercel"), "dir");

    try {
      const result = runGenerator(
        root,
        ".vercel/life-console.production.json",
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(".vercel must not be a symbolic link");
      expect(() => readFileSync(
        resolve(redirectedDirectory, "life-console.production.json"),
      )).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked output without modifying its target", () => {
    const root = createGeneratorFixture();
    const outputPath = resolve(root, ".vercel/life-console.production.json");
    const redirectedPath = resolve(root, "redirected.json");
    mkdirSync(dirname(outputPath));
    writeFileSync(redirectedPath, "unchanged\n");
    symlinkSync(redirectedPath, outputPath);

    try {
      const result = runGenerator(
        root,
        ".vercel/life-console.production.json",
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "life-console.production.json must not be a symbolic link",
      );
      expect(readFileSync(redirectedPath, "utf8")).toBe("unchanged\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
