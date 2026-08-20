const requiredEnvironmentKeys = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
];
const productionProjectName = "life-console-production";
const productionProjectUrl = "project-wpabq.vercel.app";

function requiredValue(environment, key) {
  const value = environment[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required Preview environment variable: ${key}`);
  }
  return value.trim();
}

function validateDeepSeekEnvironment(environment) {
  if (Object.prototype.hasOwnProperty.call(environment, "VITE_DEEPSEEK_API_KEY")) {
    throw new Error("DEEPSEEK_API_KEY must remain server-only");
  }
  const unexpectedDeepSeekKey = Object.keys(environment).find(
    (key) => key.includes("DEEPSEEK") && key !== "DEEPSEEK_API_KEY",
  );
  if (unexpectedDeepSeekKey) {
    throw new Error("Deployments may define only DEEPSEEK_API_KEY");
  }
}

function validateCronEnvironment(environment) {
  if (Object.prototype.hasOwnProperty.call(environment, "VITE_CRON_SECRET")) {
    throw new Error("CRON_SECRET must remain server-only");
  }
  const unexpectedCronKey = Object.keys(environment).find(
    (key) => key.includes("CRON") && key !== "CRON_SECRET",
  );
  if (unexpectedCronKey) {
    throw new Error("Deployments may define only CRON_SECRET");
  }
  if (Object.prototype.hasOwnProperty.call(environment, "CRON_SECRET")) {
    const cronCredential = environment.CRON_SECRET;
    if (
      typeof cronCredential !== "string"
      || [...cronCredential.trim()].length < 16
    ) {
      throw new Error("CRON_SECRET must contain at least 16 characters");
    }
  }
}

export function resolveCandidateProjectOrigin(environment) {
  const rawUrl = requiredValue(environment, "VITE_SUPABASE_URL");
  const url = new URL(rawUrl);
  const hostedProjectHostname =
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.supabase\.co$/;
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
    || !hostedProjectHostname.test(url.hostname.toLowerCase())
  ) {
    throw new Error(
      "VITE_SUPABASE_URL must be an exact HTTPS Supabase project origin",
    );
  }
  return url.origin;
}

export function candidateContentSecurityPolicy(environment) {
  const httpsOrigin = resolveCandidateProjectOrigin(environment);
  const wssOrigin = `wss://${new URL(httpsOrigin).host}`;
  return [
    "default-src 'self'",
    "base-uri 'none'",
    `connect-src 'self' ${httpsOrigin} ${wssOrigin}`,
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: https://images.unsplash.com",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join("; ");
}

export function createSupabaseCandidateVercelConfig(environment) {
  validateDeepSeekEnvironment(environment);
  validateCronEnvironment(environment);
  for (const key of requiredEnvironmentKeys) requiredValue(environment, key);
  const publishableKey = requiredValue(
    environment,
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  );
  if (publishableKey.startsWith("sb_secret_")) {
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY must not contain a secret key",
    );
  }
  const isValidPublishableKey = publishableKey.startsWith("sb_publishable_")
    || publishableKey.startsWith("eyJ");
  if (!isValidPublishableKey) {
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY must contain a publishable key or legacy anon JWT",
    );
  }
  if (environment.VERCEL_ENV && environment.VERCEL_ENV !== "preview") {
    throw new Error("The Supabase candidate may only deploy to Vercel Preview");
  }

  return {
    buildCommand: "npm run build:supabase-candidate",
    framework: "vite",
    installCommand: "npm ci",
    outputDirectory: "dist/supabase-candidate",
    functions: {
      "api/daily-news.ts": {
        maxDuration: 30,
        regions: ["hkg1"],
      },
      "api/cron/daily-news.ts": {
        maxDuration: 30,
        regions: ["hkg1"],
      },
    },
    rewrites: [
      {
        source: "/auth/recovery",
        destination: "/index.html",
      },
    ],
    headers: [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: candidateContentSecurityPolicy(environment),
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ],
  };
}

export function createSupabaseProductionVercelConfig(environment) {
  if (environment.VERCEL_ENV !== "production") {
    throw new Error(
      `The ${productionProjectName} config may only deploy to Vercel Production`,
    );
  }
  if (environment.VERCEL_PROJECT_NAME !== productionProjectName) {
    throw new Error(
      `Production deployment must use the ${productionProjectName} Vercel project`,
    );
  }
  if (environment.VERCEL_PROJECT_PRODUCTION_URL !== productionProjectUrl) {
    throw new Error(
      `Production deployment must target ${productionProjectName} at ${productionProjectUrl}`,
    );
  }

  const unexpectedSupabaseKey = Object.keys(environment).find(
    (key) =>
      key.includes("SUPABASE")
      && !requiredEnvironmentKeys.includes(key),
  );
  if (unexpectedSupabaseKey) {
    throw new Error(
      "Production may define only VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  const config = createSupabaseCandidateVercelConfig({
    ...environment,
    VERCEL_ENV: "preview",
  });
  return {
    ...config,
    buildCommand: "npm run build:supabase-production",
    crons: [
      {
        path: "/api/cron/daily-news",
        schedule: "0 23 * * *",
      },
    ],
    outputDirectory: "dist/supabase-production",
  };
}

export function createLifeConsoleVercelConfig(environment) {
  if (environment.VERCEL_ENV === "production") {
    return createSupabaseProductionVercelConfig(environment);
  }
  return createSupabaseCandidateVercelConfig(environment);
}
