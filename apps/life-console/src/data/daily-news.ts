import type {
  DailyNewsClient,
  DailyNewsItem,
} from "../domain/daily-news";

const syntheticItems: DailyNewsItem[] = [
  {
    id: "synthetic-technology-domestic",
    title: "合成示例：人工智能基础设施持续演进",
    summary: "本条为界面效果演示，展示正式新闻摘要的标题、分类、范围与摘要布局，不代表真实新闻。",
    url: "https://example.com/?synthetic-news=technology-domestic",
    source: "合成示例",
    publishedAt: "2030-04-10T00:00:00.000Z",
    category: "technology",
    scope: "domestic",
  },
  {
    id: "synthetic-technology-international",
    title: "合成示例：全球软件生态推进开放协作",
    summary: "演示国际科技新闻在工作台中的展示密度和长文本换行效果；内容为公开合成文本。",
    url: "https://example.com/?synthetic-news=technology-international",
    source: "合成示例",
    publishedAt: "2030-04-10T00:10:00.000Z",
    category: "technology",
    scope: "international",
  },
  {
    id: "synthetic-finance-domestic",
    title: "合成示例：公开经济数据呈现结构变化",
    summary: "演示国内财经摘要的信息层级。正式站点会展示经过白名单、时效和 Schema 校验的公开新闻。",
    url: "https://example.com/?synthetic-news=finance-domestic",
    source: "合成示例",
    publishedAt: "2030-04-10T00:20:00.000Z",
    category: "finance",
    scope: "domestic",
  },
  {
    id: "synthetic-finance-international",
    title: "合成示例：主要市场关注公开政策信号",
    summary: "演示国际财经条目。此处不提供投资建议，也不把未知原因或结果补全为确定事实。",
    url: "https://example.com/?synthetic-news=finance-international",
    source: "合成示例",
    publishedAt: "2030-04-10T00:30:00.000Z",
    category: "finance",
    scope: "international",
  },
  {
    id: "synthetic-politics-domestic",
    title: "合成示例：公共服务方案进入意见收集阶段",
    summary: "演示国内政治与公共政策条目，保留时间、人物、地点或结果未知时的不确定性。",
    url: "https://example.com/?synthetic-news=politics-domestic",
    source: "合成示例",
    publishedAt: "2030-04-10T00:40:00.000Z",
    category: "politics",
    scope: "domestic",
  },
  {
    id: "synthetic-politics-international",
    title: "合成示例：多方就公开议题继续对话",
    summary: "演示国际政治条目的最终视觉效果。正式内容仅使用可公开验证的标题、时间、片段与页面描述。",
    url: "https://example.com/?synthetic-news=politics-international",
    source: "合成示例",
    publishedAt: "2030-04-10T00:50:00.000Z",
    category: "politics",
    scope: "international",
  },
];

export const syntheticDailyNewsClient: DailyNewsClient = {
  async getDigest() {
    const generatedAt = new Date().toISOString();
    return {
      state: "success",
      digest: {
        date: generatedAt.slice(0, 10),
        generatedAt,
        items: syntheticItems,
      },
    };
  },
};
