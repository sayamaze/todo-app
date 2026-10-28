# 日程待办 · 数据与 API 契约

> 本文档固化「日程待办 App」与外部 Agent 流程之间的双边契约。
> **任何对本契约的变更必须同步通知所有依赖方**，并更新本文档与 `app/API.md`。
>
> 依赖方清单（变更时需逐一确认）：
> 1. 消息待办抓取定时任务（写入方）
> 2. 工作总结流程（读取方，解析 `completedAt` / 正文结构化字段）
> 3. 桌面悬浮小组件（读写方）
> 4. 外部工具传入原文建待办（写入方，经 `POST /api/tasks/analyze` 传原文，由本服务 AI 提炼落库）
> 5. 其他通过 REST API 写入的脚本/Agent

---

## 1. 数据文件

| 项 | 值 |
|---|---|
| 开发者机器路径 | 环境变量 `TODO_DATA_FILE` 指定 |
| 其他机器默认 | `~/Documents/日程待办/tasks.md` |
| 环境变量覆盖 | `TODO_DATA_FILE` |
| 备份目录 | `<数据文件所在目录>/backups/tasks-YYYYMMDD-HHMM.md`，每日自动备份、保留 30 份 |
| 编码 | UTF-8 明文 Markdown |

写入保证：服务端采用 `tmp + rename` 原子写入，读者不会读到半截文件。

## 2. Markdown 序列化格式

```markdown
# 日程待办清单

<!-- 头部注释（格式说明），解析时忽略 -->

## 进行中

### 2026-09-04

- [ ] 任务标题 !高 #标签1 #标签2 📅2026-09-04 <!-- id:abc123 -->
  缩进的行是任务正文描述（可选，可多行）
  - [ ] 缩进的复选行是子待办（可选，与正文二选一）
- [x] 已完成任务 !中 📅2026-09-03 ✅2026-09-04 18:30 <!-- id:def456 -->

### 无日期

- [ ] 无日期任务 <!-- id:ghi789 -->

## 已完成

- [x] ...（按完成时间倒序）
```

### 行内标记（任务行）

| 标记 | 含义 | 解析正则 |
|---|---|---|
| `- [ ]` / `- [x]` | 未完成 / 已完成 | 行首 |
| `!高` `!中` `!低` | 优先级 high/medium/low（无标记 = none） | `/!(高|中|低)/` |
| `#标签` | 标签，多个空格分隔 | `/#([^\s#]+)/g` |
| `📅YYYY-MM-DD` | 完成日期 | `/📅(\d{4}-\d{2}-\d{2})/` |
| `✅YYYY-MM-DD[ HH:mm]` | 完成时间（仅已完成任务） | `/✅(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/` |
| `<!-- id:xxx -->` | 任务唯一 ID（**必填，行尾**） | `/<!-- id:([A-Za-z0-9-]+) -->$/` |
| `🔁daily` `🔁weekly` `🔁weekday` | 重复周期（v1.3.0 新增，可选） | `/🔁(daily|weekly|weekday)/` |

### 正文与子待办

- 任务行之后、**两格缩进**的非复选行 = `description`（可多行，原顺序拼接）
- 两格缩进的 `- [ ] / - [x]` 行 = `subtasks`（与正文并存时序列化先写正文再写子待办）
- 分组标题 `### 日期` 由应用序列化时生成，**解析器不依赖它**，外部写入可不写

## 3. 任务对象 Task（JSON）

| 字段 | 类型 | 说明 | 契约级别 |
|---|---|---|---|
| `id` | string | 唯一 ID，创建时生成（时间基36进制+随机） | 稳定 |
| `title` | string | 标题，必填非空 | 稳定 |
| `description` | string | 正文描述，可多行 | 稳定 |
| `subtasks` | `{title:string, done:boolean}[]` | 子待办 | 稳定 |
| `date` | string \| null | `YYYY-MM-DD`，null = 无日期 | 稳定 |
| `priority` | `"high"\|"medium"\|"low"\|"none"` | 优先级 | 稳定 |
| `tags` | string[] | 标签（不含 `#` 前缀） | 稳定 |
| `done` | boolean | 是否完成 | 稳定 |
| `completedAt` | string \| null | `YYYY-MM-DD HH:mm` 或 `YYYY-MM-DD` | 稳定 |
| `recur` | `"daily"\|"weekly"\|"weekday"\|null` | 重复周期（v1.3.0 新增） | 新增-可选 |

新增字段原则：**只增不改**，旧版本应用忽略未知字段（序列化时会丢弃，外部工具不应依赖未知字段持久化）。

## 4. 正文结构化约定（方向判定 & 消息渲染）

vChat 抓取流程写入的任务正文按以下约定格式书写，App 据此做结构化渲染与方向分类：

```text
来源：群名或会话名
发起人：姓名或工号
消息：原始消息内容
责任人：姓名1、姓名2
（我提出的任务）
今日进展：自由文本进展记录（可多段）
```

- 每个 `来源/发起人/消息` 三元组构成一个**消息块**；同一任务允许多个消息块（vChat 持续追加），块内顺序保持原始时序
- `责任人` + `（我提出的任务）` 标记该任务为「我安排的」
- 未匹配约定字段的行按普通正文展示

### 方向三分类（App 侧判定逻辑）

| 方向 | 判定规则 | 展示 |
|---|---|---|
| 我提出的（outgoing） | `tags` 含「我安排的」**或** 正文含 `（我提出的任务）` | 左侧紫色标识条 |
| 我收到的（incoming） | 非 outgoing 且正文含 `来源：` 或 `发起人：` 字段 | 蓝色头像徽章 |
| 我创建的（mine） | 其余（手动创建） | 无特殊标识 |

**约定字段名不可更改**（来源/发起人/责任人/消息/（我提出的任务）），vChat 抓取与 App 渲染双边硬依赖。

## 5. REST API

Base URL：`http://localhost:7100/api/tasks`（端口被占用时自动换，以 `GET /api/tasks` 返回的 `file` 字段所在实例为准）。CORS 全开、无鉴权。

### 查询（稳定）

| 方法与路径 | 返回 |
|---|---|
| `GET /api/tasks` | `{ file, mtime, tasks }` |
| `GET /api/tasks/version` | `{ mtime }` —— 轻量轮询用 |
| `GET /api/tasks/today[?includeOverdue=1]` | `{ date, count, tasks }` |
| `GET /api/tasks/week` | `{ from, to, count, tasks }` |
| `GET /api/tasks/completed` | `{ count, tasks }` 按完成时间倒序 |
| `GET /api/tasks/overdue` | `{ count, tasks }` |
| `GET /api/tasks/tag/:tag` | `{ tag, count, tasks }` |
| `GET /api/tasks/tags` | `{ tags: [{tag, count}] }` |
| `GET /api/tasks/:id` | `{ task }` |
| `GET /api/tasks/stats/weekly` | 周完成统计（v1.3.0 新增） |

### 写入（稳定）

| 方法与路径 | 说明 |
|---|---|
| `POST /api/tasks` | 创建，body 除 `title` 外均可省略，返回 `201 { ok, task }` |
| `PATCH /api/tasks/:id` | 部分更新（title/description/subtasks/date/priority/tags/done） |
| `POST /api/tasks/:id/complete` · `/uncomplete` | 完成 / 取消完成（自动写/清 `completedAt`） |
| `DELETE /api/tasks/:id` | 删除 |
| `PUT /api/tasks` | 全量替换，body `{ tasks: Task[], baseMtime?: number \| null }` |

### PUT 乐观锁（v1.2.3 新增，行为契约）

- 调用方传入读取时的 `mtime` 作为 `baseMtime`
- 若文件当前 `mtime` 与 `baseMtime` 不一致 → `409 { error, mtime, tasks }`（返回最新数据，**不写入**）
- `baseMtime` 传 `null` 或不传 → 跳过校验（兼容旧调用方，但有覆盖风险，不推荐）
- 推荐冲突处理：将 `tasks` 中本地没有的 ID 并入本地结果后，用新的 `mtime` 重试

### 错误格式

`{ "error": "中文描述" }`；400 参数错误 / 404 不存在 / 409 版本冲突 / 500 服务器错误。

## 6. 外部直接编辑 Markdown 的注意事项

1. 每条任务行必须以 `<!-- id:xxx -->` 结尾，缺失的行会被忽略
2. 标题中的 `#`、`<!--` 会被清洗；标签内不允许空格与 `#`
3. 正文行必须严格两格缩进，否则被忽略
4. 编辑后 App 端 3 秒内通过 `/api/tasks/version` 轮询自动刷新，无需通知
5. 直接改文件绕过乐观锁：请在 App 空闲时改，或改用 `POST/PATCH` 单任务接口（天然无冲突）

---

版本：v1.3.0（2026-09-04 制定）
