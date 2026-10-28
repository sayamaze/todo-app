# 需求：新增「AI 分析建待办」接口（接收外部原文 → AI 提炼 → 生成结构化待办）

> 下发方：Tendedero 二次开发分支（截图晾衣绳）
> 承接方：日程待办 APP
> 类型：新增开放 API 接口 + AI 分析能力
> 优先级：一个会话内可完成

---

## 一、背景与目标

Tendedero（截图晾衣绳工具）新增了文本便签卡功能，并在右键菜单加了「添加至日程待办」。用户点击后，Tendedero 会把便签的**纯文本原文** POST 到日程待办 APP。

日程待办 APP 需要新增一个接口：**接收原文 → 调用 AI 模型提炼关键信息 → 自动创建一条结构化待办**。

分工约定（已确认）：
- **Tendedero**：只负责传原文，不做任何 AI 分析，不理解"日程语义"。
- **日程待办**：负责 AI 提炼（主题、事项拆解、标签、日期、优先级）并落库。这是待办的本职能力。

## 二、接口契约（Tendedero → 日程待办）

### 请求

```
POST http://localhost:7100/api/tasks/analyze
Content-Type: application/json

{
  "text": "要分析的原文（多行纯文本）",
  "source": "tendedero"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | 是 | 待分析的原文，纯文本，可多行 |
| `source` | string | 否 | 来源标识，便于追溯，如 `tendedero`、`vchat` |

约束：
- 与现有 API 一致：本地 REST、无需鉴权、已开 CORS
- `text` 为空或纯空白 → 返回 400 `{ "error": "text 不能为空" }`
- 建议对 `text` 长度设上限（如 5000 字符），超出截断或报 400

### 响应

**同步完成**（推荐，AI 分析快的话）：

```
HTTP 201
{
  "ok": true,
  "task": { "id": "...", "title": "...", "date": "...", "tags": [...], "subtasks": [...], "priority": "..." },
  "analysis": { "title": "...", "tags": [...], "date": "...", "subtasks": [...] }
}
```

**异步**（若 AI 分析耗时较长）：

```
HTTP 202
{ "ok": true, "pending": true, "id": "<暂存ID>" }
```

> Tendedero 侧目前按"200-299 即成功"处理，两种响应都兼容。建议优先同步 201，让用户能立即在待办里看到结果。

## 三、AI 提炼规格

接口收到 `text` 后，调用 AI 模型提炼以下字段，映射到现有 Task 结构：

| 提炼项 | → Task 字段 | 说明 |
|---|---|---|
| 主题 | `title` | 一句话概括事项，≤30 字，动词开头 |
| 事项拆解 | `subtasks` | 若原文含多个步骤/要点，拆成子待办 `[{"title":"...","done":false}]`；单条事项可留空 |
| 标签 | `tags` | 1-3 个分类标签，参考现有标签体系（工作/生活/AI成本 等），可新建 |
| 日期 | `date` | 从原文识别时间（"明天""下周三""10-25"等）转 `YYYY-MM-DD`；无时间则 `null` |
| 优先级 | `priority` | 默认 `none`；原文含"紧急""尽快""重要"等 → `high`/`medium` |

### Prompt 设计要点（供参考）

- 输入：原文 + 今天日期（用于相对日期换算）
- 要求模型**只输出 JSON**，字段：`{ title, subtasks[], tags[], date, priority }`
- 日期一律输出 `YYYY-MM-DD` 或 `null`，相对日期以"今天"为基准换算
- 拿不准的字段宁可留空（date=null、tags=[]），不要编造

### 容错

- 模型返回非 JSON / 字段缺失 → 降级：用原文首行作 `title`，其余字段留空，仍成功建待办（不报错）
- 模型调用失败（网络/key 问题）→ 返回 500 `{ "error": "AI 分析失败：<原因>" }`，**不要**静默建一条空待办

## 四、模型配置

- 复用日程待办既有的模型配置机制（若无，则需新增：模型选择 + API key 存储，建议走环境变量或配置文件，**不要硬编码 key**）
- 模型选择：提炼属轻量结构化任务，用快速/廉价模型即可（如 DeepSeek Flash 级别）

## 五、验收标准

1. `POST /api/tasks/analyze` 传一段含时间的事项原文（如"明天下午3点和小明对齐相册方案，先准备数据，再约会议室"），返回 201，且 tasks.md 中新增一条：
   - title 涵盖核心事项
   - date 为明天
   - subtasks 含"准备数据""约会议室"
2. 传无时间纯描述原文，返回 201，date 为 null
3. 传空 text，返回 400
4. 模型失效时返回 500 且不产生脏数据
5. 与现有 `POST /api/tasks` 写入走同一套持久化（原子写 tasks.md、每日备份）

## 六、文档同步

接口实现后，请同步更新：
- `app/API.md`：新增 analyze 接口说明
- `CONTRACT.md`：把 Tendedero 加入依赖方清单（写入方）

---

## 附：Tendedero 侧已实现（供对联）

- 文件：`Sources/Tendedero/TodoSender.swift`（HTTP 发送）、`Line.addToTodo(_:)`、右键菜单「添加至日程待办」（仅文本卡显示）
- 端点写死在 `TodoSender.endpoint = "http://localhost:7100/api/tasks/analyze"`，端口若变可改这一处
- 成功：卡片显示绿色对勾 + Tink 音效；失败：系统提示音 + 日志

对联方式：待办侧接口就绪后，在 Tendedero 右键文本卡 → 添加至日程待办 → 检查 tasks.md 是否新增结构化待办。
