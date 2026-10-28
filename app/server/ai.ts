// AI 提炼：把外部原文（便签/消息）提炼为结构化待办字段。
// 走本地 Ollama（离线、无需 key），默认 deepseek-r1:14b。
// Ollama 不常驻：11434 不通时按需拉起 `ollama serve`，就绪后再调；
// 模型推理完约 4 分钟无请求自动卸载（Ollama 自身机制），主进程由用户按需退出。
// 配置走环境变量，不硬编码：
//   TODO_AI_ENDPOINT   Ollama 地址，默认 http://localhost:11434
//   TODO_AI_MODEL      模型名，默认 deepseek-r1:14b
//   TODO_AI_TIMEOUT_MS 单次调用超时（毫秒），默认 120000

import { spawn } from "node:child_process";

export interface AiAnalysis {
  title: string;
  subtasks: string[];
  tags: string[];
  date: string | null;
  priority: "none" | "low" | "medium" | "high";
}

const ENDPOINT = () => (process.env.TODO_AI_ENDPOINT ?? "http://localhost:11434").replace(/\/+$/, "");
const MODEL = () => process.env.TODO_AI_MODEL ?? "deepseek-r1:14b";
const TIMEOUT = () => Number(process.env.TODO_AI_TIMEOUT_MS ?? 120000);

const SYSTEM_PROMPT = `你是待办事项提炼助手。把用户给的原文提炼为一条结构化待办。
只输出 JSON，不要输出任何其他文字、解释或 Markdown 代码块。
字段：
- title: 一句话概括事项，≤30 字，动词开头
- subtasks: 字符串数组；原文含多个步骤/要点时逐条拆解（不要带序号），单条事项为空数组
- tags: 1-3 个分类标签字符串数组，参考常见体系（工作/生活/AI成本/X500U/X600 等），可新建
- date: YYYY-MM-DD 或 null；原文中的相对日期（明天/下周三/周五）以今天为基准换算，无时间信息输出 null
  「下周X」指下一个完整自然周的周X，不是从今天起的第7天；「这/本周X」指当前自然周的周X
- priority: none/low/medium/high 之一；默认 none；原文含"紧急""尽快""重要"等提升
拿不准的字段宁可留空（date=null、tags=[]），不要编造。`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-22" → "周三" */
function weekdayLabel(dateStr: string): string {
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const d = new Date(dateStr + "T00:00:00");
  return labels[d.getDay()];
}
const PRIORITIES = ["none", "low", "medium", "high"] as const;

/** 从模型输出中稳健提取 JSON 对象（容忍首尾杂讯/代码块包裹） */
function extractJson(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : t;
  try {
    const v = JSON.parse(candidate);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    const m = candidate.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const v = JSON.parse(m[0]);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

/** 规范化模型输出的任意形态为 AiAnalysis（字段缺失时给空值） */
function normalizeAnalysis(o: Record<string, unknown>): AiAnalysis {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
  const date = str(o.date);
  const pr = str(o.priority).toLowerCase();
  return {
    title: str(o.title),
    subtasks: strArr(o.subtasks),
    tags: strArr(o.tags).map((t) => t.replace(/^[#\s]+/, "")).filter(Boolean).slice(0, 3),
    date: DATE_RE.test(date) ? date : null,
    priority: (PRIORITIES as readonly string[]).includes(pr) ? (pr as AiAnalysis["priority"]) : "none",
  };
}

export class AiError extends Error {}

let ensureServePromise: Promise<void> | null = null;

/** 11434 是否已有 Ollama serve 在响应 */
async function isServeUp(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${ENDPOINT()}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** 确保 Ollama serve 就绪：不通则 spawn `ollama serve` 并轮询等待（最多 20s）。并发调用共享同一 Promise，避免重复拉起。 */
function ensureServe(): Promise<void> {
  if (ensureServePromise) return ensureServePromise;
  ensureServePromise = (async () => {
    if (await isServeUp()) return;
    let child;
    try {
      child = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
      child.unref(); // 不阻塞父进程退出
    } catch (e) {
      throw new AiError(`无法拉起本地 Ollama：${e instanceof Error ? e.message : String(e)}（请确认已安装 Ollama）`);
    }
    child.on("error", () => {});
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isServeUp()) return;
    }
    throw new AiError("Ollama serve 拉起后 20s 内未就绪");
  })().finally(() => {
    // 无论成败都允许下次重试（成功时 isServeUp 会快速短路）
    ensureServePromise = null;
  });
  return ensureServePromise;
}

/** 本地预解析常见相对日期表述，返回确定日期（不依赖模型算日期，避免歧义） */
function preResolveDate(text: string, today: string): string | null {
  const t = new Date(today + "T00:00:00");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

  // 明天/后天/大后天
  if (/大后天/.test(text)) return fmt(addDays(t, 3));
  if (/后天/.test(text)) return fmt(addDays(t, 2));
  if (/明天/.test(text)) return fmt(addDays(t, 1));
  if (/今天/.test(text)) return fmt(t);

  // 下周X / 下下周X / 这|本周X / 周X|星期X（不带前缀 = 本周或下周最近的一个）
  const WEEKDAYS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const m = text.match(/(下下|下|这|本)?周([日天一二三四五六])/) ?? text.match(/(下下|下|这|本)?星期([日天一二三四五六])/);
  if (m) {
    const prefix = m[1] ?? "";
    const targetDay = WEEKDAYS[m[2]];
    const todayDay = t.getDay();
    // 本周的 target
    let diff = targetDay - todayDay;
    if (prefix === "下") diff += 7;
    else if (prefix === "下下") diff += 14;
    else if (prefix === "" && diff <= 0) diff += 7; // 不带前缀：今天或已过 → 下周
    // "这"/"本" 前缀：保持 diff 原样（可能为负=已过去的本周某天）
    return fmt(addDays(t, diff));
  }

  return null;
}

/** 构建 user prompt：注入今天日期+星期，以及已有标签列表（约束模型只从中匹配） */
function buildUserPrompt(text: string, today: string, existingTags?: string[]): string {
  let p = `今天是 ${today}（${weekdayLabel(today)}）。`;
  if (existingTags && existingTags.length > 0) {
    p += `\n已有标签列表：${existingTags.join("、")}。tags 字段只能从该列表中选取匹配的标签，不要创建新标签；无匹配则输出空数组。`;
  } else {
    p += `\ntags 字段输出空数组（当前无已有标签可匹配）。`;
  }
  p += `\n原文：${text}`;
  return p;
}

/** 调本地 Ollama 提炼原文。失败抛 AiError；模型输出无法解析为 JSON 时返回 null（走降级）。
    existingTags 传入时，模型只从中匹配标签，不新建。 */
export async function analyzeTaskText(text: string, today: string, existingTags?: string[]): Promise<AiAnalysis | null> {
  await ensureServe();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT());
  let raw: string;
  try {
    const res = await fetch(`${ENDPOINT()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL(),
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(text, today, existingTags) },
        ],
      }),
    });
    if (!res.ok) throw new AiError(`Ollama 返回 ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    raw = data.message?.content ?? "";
  } catch (e) {
    if (e instanceof AiError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new AiError(
      msg.includes("abort")
        ? `AI 分析超时（>${TIMEOUT()}ms）`
        : `AI 服务调用失败：${msg}`
    );
  } finally {
    clearTimeout(timer);
  }
  const parsed = extractJson(raw);
  if (!parsed) return null;
  const a = normalizeAnalysis(parsed);
  // 本地预解析日期优先于模型输出（模型算相对日期不可靠）
  const localDate = preResolveDate(text, today);
  if (localDate) a.date = localDate;
  return a.title ? a : null;
}
