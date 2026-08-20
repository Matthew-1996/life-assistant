import { getCache } from "@vercel/functions";

import type { DailyNewsDigest } from "../domain/daily-news.js";
import type { DailyNewsCachePort } from "./daily-news-service.js";
import { validateDailyNewsDigest } from "./daily-news-validator.js";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const LAST_SUCCESS_KEY = "daily-news:v1:last-success";

export interface RuntimeCacheLike {
  get(key: string): Promise<unknown | null>;
  set(
    key: string,
    value: unknown,
    options?: { name?: string; tags?: string[]; ttl?: number },
  ): Promise<void>;
}

function datedKey(date: string): string {
  return `daily-news:v1:${date}`;
}

async function readValid(
  runtime: RuntimeCacheLike,
  key: string,
): Promise<DailyNewsDigest | undefined> {
  const value = await runtime.get(key);
  if (value === null || value === undefined) return undefined;
  try {
    return validateDailyNewsDigest(value);
  } catch {
    return undefined;
  }
}

export function createRuntimeDailyNewsCache(
  runtime: RuntimeCacheLike = getCache(),
): DailyNewsCachePort {
  const options = {
    name: "Life Console daily news",
    tags: ["daily-news"],
    ttl: CACHE_TTL_SECONDS,
  };
  return {
    async get(date) {
      return await readValid(runtime, datedKey(date));
    },

    async getLastSuccess() {
      return await readValid(runtime, LAST_SUCCESS_KEY);
    },

    async setSuccessful(digest) {
      const validated = validateDailyNewsDigest(digest);
      await runtime.set(datedKey(validated.date), validated, options);
      await runtime.set(LAST_SUCCESS_KEY, validated, options);
    },
  };
}
