// 任务正文结构化解析、方向判定、标签配色等纯函数。
// 与 Home.tsx / TaskRow 共用，不依赖 React。

import type { Task } from "@/types/task";

/** 方向判定：标签含「我安排的」或正文含「（我提出的任务）」→ 我提出的 */
export function isOutgoingTask(task: Task): boolean {
  return (
    (task.tags ?? []).includes("我安排的") ||
    (task.description ?? "").includes("（我提出的任务）")
  );
}

/** 任务方向三分类：我提出的 / 我收到的（含来源或发起人字段）/ 我创建的（其余，即手动创建） */
export type TaskDirection = "outgoing" | "incoming" | "mine";

export function taskDirection(task: Task): TaskDirection {
  if (isOutgoingTask(task)) return "outgoing";
  const p = parseDescription(task.description ?? "");
  if (p.blocks.some((b) => b.source || b.initiator)) return "incoming";
  return "mine";
}

/** 单个消息块：一次「来源/发起人/消息」三元组（vChat 持续追加时同一任务可有多个） */
export interface MessageBlock {
  source: string;
  initiator: string;
  message: string;
  /** 我提出的任务：该块附带的责任人 */
  owner: string;
  isSelf: boolean;
}

/** 正文结构化解析结果（配合 Agent 自动生成待办的约定格式，支持多消息块） */
export interface ParsedDesc {
  blocks: MessageBlock[];
  /** 进展记录行（今日进展：…），按时序展示 */
  progress: string[];
  /** 未匹配到约定字段的剩余行，仍按普通正文展示 */
  rest: string[];
}

function emptyBlock(): MessageBlock {
  return { source: "", initiator: "", message: "", owner: "", isSelf: false };
}

function blockHasContent(b: MessageBlock): boolean {
  return !!(b.source || b.initiator || b.message || b.owner || b.isSelf);
}

/** 无来源/发起人的孤立行不应独立成块（通常是上一块消息的换行续写） */
function blockHasAnchor(b: MessageBlock): boolean {
  return !!(b.source || b.initiator);
}

export function parseDescription(text: string): ParsedDesc {
  const result: ParsedDesc = { blocks: [], progress: [], rest: [] };
  if (!text) return result;

  let cur = emptyBlock();
  let inBlock = false; // 是否处于消息块上下文（普通正文行会打断）
  const pushCur = () => {
    if (blockHasContent(cur)) result.blocks.push(cur);
    cur = emptyBlock();
  };

  for (const line of text.split("\n")) {
    const t = line.trim();
    const m = t.match(/^(来源|发起人|责任人|消息)[：:]\s*(.*)$/);
    if (m) {
      // 「来源」出现且当前块已有内容 → 开启新块（一次新追加）
      if (m[1] === "来源" && blockHasContent(cur)) pushCur();
      inBlock = true;
      if (m[1] === "来源") cur.source = m[2];
      else if (m[1] === "发起人") cur.initiator = m[2];
      else if (m[1] === "责任人") cur.owner = m[2];
      else cur.message = cur.message ? cur.message + "\n" + m[2] : m[2];
    } else if (t === "（我提出的任务）" || t === "(我提出的任务)") {
      if (inBlock) cur.isSelf = true;
      else result.rest.push(line);
    } else if (t.startsWith("今日进展：") || t.startsWith("今日进展:")) {
      pushCur();
      inBlock = false;
      result.progress.push(t.replace(/^今日进展[：:]\s*/, ""));
    } else {
      // 块内的普通行 = 上一字段的续写；块外 = 普通正文
      if (inBlock && t) {
        cur.message = cur.message ? cur.message + "\n" + t : t;
      } else {
        if (inBlock) {
          // 块结束后回归正文：闭合无锚点的孤立块避免碎块
          pushCur();
          inBlock = false;
        }
        result.rest.push(line);
      }
    }
  }
  pushCur();
  // 清理：无锚点（来源/发起人）的块并入 rest，保持原始顺序放在最前（旧数据兼容）
  const anchored: MessageBlock[] = [];
  const orphans: string[] = [];
  for (const b of result.blocks) {
    if (blockHasAnchor(b)) anchored.push(b);
    else if (b.message) orphans.push(b.message);
  }
  result.blocks = anchored;
  if (orphans.length) result.rest = [...orphans, ...result.rest];
  return result;
}

export function hasStructuredDesc(p: ParsedDesc): boolean {
  return p.blocks.length > 0 || p.progress.length > 0;
}

/** 「日常工作」保留标签名：无标签任务的默认归集，与其他手动输入标签互斥 */
export const DAILY_WORK_TAG = "日常工作";

/** 解析标签输入：支持空格/逗号/顿号分隔，自动去除开头的 # */
export function parseTagsInput(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,，、]+/)
        .map((s) => s.replace(/^#+/, "").trim())
        .filter(Boolean)
    ),
  ];
}

/** 强制「日常工作」互斥：与其他手动标签共存时，保留后出现的一方。
    规则：含「日常工作」且还有其他标签 → 移除「日常工作」（其他标签优先，
    因为手动输入其他标签通常是有意归类）；仅剩「日常工作」或无标签 → 原样返回。 */
export function enforceDailyExclusive(tags: string[]): string[] {
  if (tags.length > 1 && tags.includes(DAILY_WORK_TAG)) {
    return tags.filter((t) => t !== DAILY_WORK_TAG);
  }
  return tags;
}

/** 标签配色：方向标签（我安排的 / 我收到的）统一紫色；自建标签用更明显的蓝色 */
export function tagChipClass(tag: string, active = false): string {
  if (tag === "我安排的" || tag === "我收到的")
    return active
      ? "bg-violet-500 text-white"
      : "bg-violet-50 text-violet-600 hover:bg-violet-100";
  return active
    ? "bg-blue-500 text-white"
    : "bg-blue-50 text-blue-600 hover:bg-blue-100";
}

/** 头像配色：按名字哈希取稳定颜色 */
const AVATAR_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#06b6d4",
  "#f97316",
];
export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** URL 识别：http(s):// 或 www. 开头，排除中英文常见结尾标点 */
export const URL_RE =
  /(https?:\/\/[^\s<>"'（）【】，。；、！？]+|www\.[^\s<>"'（）【】，。；、！？]+)/g;

/** 文本中是否包含可识别链接 */
export function hasUrl(text: string): boolean {
  return /(https?:\/\/|www\.)\S/.test(text);
}
