# DeepSeek API 接入

本项目提供一个不依赖第三方 Python 包的 OpenAI-compatible DeepSeek 适配器：

```bash
python3 tools/deepseek_api.py --help
```

官方接口地址为 `https://api.deepseek.com`。默认模型是当前的低延迟模型
`deepseek-v4-flash`；复杂任务可在请求中改为 `deepseek-v4-pro`。旧的
`deepseek-chat` 与 `deepseek-reasoner` 名称不再作为默认值。

## 1. 安全配置 API Key

Mac 推荐使用系统钥匙串。命令会由 `security` 工具直接提示输入，密钥不会出现在
命令行参数、仓库文件或 Python 日志中：

```bash
python3 tools/deepseek_api.py configure
```

服务器或 CI 可以使用环境变量：

```bash
export DEEPSEEK_API_KEY="你的密钥"
```

可选环境变量：

- `DEEPSEEK_MODEL`：默认 `deepseek-v4-flash`；
- `DEEPSEEK_BASE_URL`：默认 `https://api.deepseek.com`，只接受 HTTPS；
- `DEEPSEEK_TIMEOUT_SECONDS`：默认 120，允许 1–1800 秒。

不要把真实密钥写入 `.env.example`、Prompt、聊天、Git、日记或状态台账。

## 2. 验证连接

```bash
python3 tools/deepseek_api.py check
```

该命令调用 `GET /models`，只输出服务地址、默认模型和可用模型，不输出密钥。

## 3. 发起对话

请求 JSON 必须通过 stdin 传入，避免把 Prompt 留在 shell 命令参数中：

```bash
printf '%s\n' '{"messages":[{"role":"user","content":"Hello"}]}' \
  | python3 tools/deepseek_api.py chat
```

日常快速调用可显式关闭思考模式：

```bash
printf '%s\n' '{"messages":[{"role":"user","content":"Hello"}]}' \
  | python3 tools/deepseek_api.py chat --thinking disabled
```

复杂任务可使用：

```bash
printf '%s\n' '{"messages":[{"role":"user","content":"Analyze this problem"}]}' \
  | python3 tools/deepseek_api.py chat --model deepseek-v4-pro \
      --thinking enabled --reasoning-effort max
```

流式输出使用 `--stream`；需要完整 API 响应或原始 SSE JSON 行时再显式加 `--raw`。
默认紧凑输出不包含 `reasoning_content`，但保留答案、模型、停止原因、工具调用和
token 用量。

## 隐私与失败边界

- 适配器不会主动读取 `USER.md`、`MEMORY.md`、日记、状态、Apple Health 或工作簿；
- 只有调用者明确传入 stdin 的内容会发送到 DeepSeek；
- 把个人生活数据发往 DeepSeek 属于新的外部共享范围，必须先取得用户对具体范围的同意；
- 401 通常表示密钥无效，402 表示余额不足，429 表示并发或限速，500/503 表示服务端错误；
- 工具不自动重试付费的对话请求，避免连接异常时造成不可见的重复计费。

官方参考：

- https://api-docs.deepseek.com/zh-cn/
- https://api-docs.deepseek.com/api/create-chat-completion
- https://api-docs.deepseek.com/api/list-models
- https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/
