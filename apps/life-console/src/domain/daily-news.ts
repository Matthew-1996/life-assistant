export type DailyNewsCategory = "technology" | "finance" | "politics";
export type DailyNewsScope = "domestic" | "international";

export interface DailyNewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  category: DailyNewsCategory;
  scope: DailyNewsScope;
}

export interface DailyNewsDigest {
  date: string;
  generatedAt: string;
  items: DailyNewsItem[];
}

export type DailyNewsResult =
  | { state: "success"; digest: DailyNewsDigest }
  | { state: "stale"; digest: DailyNewsDigest; failedAt: string }
  | { state: "empty"; retryable: true };

export interface DailyNewsClient {
  getDigest(options: { allowRebuild: boolean }): Promise<DailyNewsResult>;
}
