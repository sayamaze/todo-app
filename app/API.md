# 日程待办 · 开放 API 文档

本地 REST API，随应用开发服务器一起启动，无需鉴权，已开启 CORS（允许任意来源跨域调用），其他本地应用、脚本、Agent 均可直接调用。

- Base URL：`http://localhost:7100/api/tasks`（桌面 App 默认 7100，被占用时自动换端口，以实际为准；开发服务器默认 3000）
- 数据格式：JSON，UTF-8
- 所有写操作实时持久化到明文文件（Markdown，Agent 也可直接读写）：
  - 数据文件路径由环境变量 `TODO_DATA_FILE` 指定（开发者机器）
  - 其他机器默认：`~/Documents/日程待办/tasks.md`，可用环境变量 `TODO_DATA_FILE` 自定义

## 任务对象 Task

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一 ID，创建时自动生成 |
| `title` | string | 标题（必填） |
| `description` | string | 正文描述，可多行 |
| `subtasks` | object[] | 子待办列表，如 `[{"title":"步骤一","done":false}]`；非空时内容以清单模式展示 |
| `date` | string \| null | 完成日期 `YYYY-MM-DD`，`null` 为无日期 |
| `priority` | string | `high` / `medium` / `low` / `none` |
| `tags` | string[] | 标签列表，如 `["工作", "AI"]` |
| `done` | boolean | 是否完成 |
| `completedAt` | string \| null | 完成时间 `YYYY-MM-DD HH:mm`（未完成时为 null） |

## 查询接口

| 方法与路径 | 说明 |
|---|---|
| `GET /api/tasks` | 全部任务，返回 `{ file, tasks }` |
| `GET /api/tasks/today` | 今日未完成清单；加 `?includeOverdue=1` 可同时包含已过期 |
| `GET /api/tasks/week` | 最近 7 天未完成清单 |
| `GET /api/tasks/completed` | 已完成清单（按完成时间倒序） |
| `GET /api/tasks/overdue` | 已过期未完成清单 |
| `GET /api/tasks/tag/:tag` | 指定标签下的未完成清单，如 `/api/tasks/tag/工作` |
| `GET /api/tasks/tags` | 所有标签及任务计数 |
| `GET /api/tasks/:id` | 单个任务详情 |

## 写入接口

### 创建任务 `POST /api/tasks`

```bash
curl -X POST http://localhost:7100/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"写周报","description":"整理本周数据","date":"2026-08-08","priority":"high","tags":["工作"]}'
```

返回 `201 { ok, task }`。除 `title` 外均可省略。

### 更新任务 `PATCH /api/tasks/:id`

只传需要修改的字段（`title` / `description` / `date` / `priority` / `tags` / `done` 均可）：

```bash
curl -X PATCH http://localhost:7100/api/tasks/<id> \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-08-10","priority":"medium"}'
```

快捷调整日期示例：明天 = 当天日期 +1；下周 = 当天日期 +7（由调用方计算后传入）。

### 完成 / 取消完成

```bash
curl -X POST http://localhost:7100/api/tasks/<id>/complete
curl -X POST http://localhost:7100/api/tasks/<id>/uncomplete
```

### 删除任务

```bash
curl -X DELETE http://localhost:7100/api/tasks/<id>
```

### 全量替换 `PUT /api/tasks`

Web 前端使用的批量写入方式，body 为 `{ "tasks": Task[] }`，会整体重写清单文件。

### AI 分析建待办 `POST /api/tasks/analyze`

接收外部工具传入的**原文**，调用本地 AI 模型提炼为结构化待办并落库。面向不理解日程语义的上游工具：上游只传原文，提炼由本服务负责。

```bash
curl -X POST http://localhost:7100/api/tasks/analyze \
  -H "Content-Type: application/json" \
  -d '{"text":"明天下午3点和小明对齐相册方案，先准备数据，再约会议室","source":"tendedero"}'
```

| 请求字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | 是 | 待分析原文，可多行；空/纯空白返回 400；上限 5000 字符 |
| `source` | string | 否 | 来源标识（如 `tendedero`），非空时以「来源：xxx」前缀写入任务正文便于追溯 |

成功返回 `201 { ok, task, analysis, degraded }`：
- `task` 为落库后的完整任务（标题、子待办、标签、日期、优先级均由 AI 提炼）
- `analysis` 为 AI 提炼的原始字段
- `degraded`：模型输出无法解析时为 `true`，此时用原文首行作标题降级建待办（仍成功）

提炼规则：`title` ≤30 字动词开头；多步骤拆 `subtasks`；`tags` 1-3 个参考现有体系；`date` 从原文相对/绝对时间换算为 `YYYY-MM-DD`（以当天为基准），无时间为 `null`；含「紧急/尽快/重要」提升 `priority`；拿不准的字段留空不编造。

错误：`400` text 为空或超长；`500` AI 服务不可用/调用失败（**不产生脏数据**）。

**本地模型依赖**：走本机 Ollama（离线、无需 key），默认模型 `deepseek-r1:14b`。Ollama 无需常驻——接口被调用时若 11434 端口无响应，会自动拉起 `ollama serve` 并就绪后再调用；模型推理完约 4 分钟无请求自动卸载（Ollama 自身机制）。可用环境变量覆盖：`TODO_AI_ENDPOINT`（默认 `http://localhost:11434`）、`TODO_AI_MODEL`（默认 `deepseek-r1:14b`）、`TODO_AI_TIMEOUT_MS`（默认 `120000`）。需本机已安装 Ollama 且已 `ollama pull deepseek-r1:14b`。

## 错误格式

所有错误返回 JSON：`{ "error": "中文错误描述" }`，HTTP 状态码：400 参数错误 / 404 任务不存在 / 500 服务器错误。

## 典型场景

```bash
# 其他应用查询今天要做什么
curl -s http://localhost:7100/api/tasks/today

# 写入一条明天的低优先级任务
curl -X POST http://localhost:7100/api/tasks -H "Content-Type: application/json" \
  -d '{"title":"给妈妈打电话","date":"2026-08-08","priority":"low","tags":["生活"]}'
```
