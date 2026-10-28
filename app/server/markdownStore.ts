import fs from "node:fs";
import path from "node:path";

// ---------- 每日自动备份（保留 30 份） ----------
// 策略：进程启动时若无当日备份则立即建一份；之后每次写入时若当日尚无备份也补建。
// 命名沿用历史约定 tasks-YYYYMMDD-HHMM.md（历史备份时刻 21:43 即此前启动备份的时间点）。

const MAX_BACKUPS = 30;

function backupStamp(): { day: string; stamp: string } {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return { day, stamp: `${day}-${p(d.getHours())}${p(d.getMinutes())}` };
}

function pruneBackups(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^tasks-\d{8}-\d{4}\.md$/.test(f))
      .sort();
    while (files.length > MAX_BACKUPS) {
      const f = files.shift()!;
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        /* 单个删除失败不阻塞 */
      }
    }
  } catch {
    /* 目录不可读时跳过清理 */
  }
}

/** 若当日尚无备份，则将当前数据文件复制一份到 backups/；当日已存在则跳过（保留当日最早状态） */
export function backupDaily(dataFile: string): void {
  try {
    if (!fs.existsSync(dataFile)) return;
    const { day, stamp } = backupStamp();
    const dir = path.join(path.dirname(dataFile), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const exists = fs
      .readdirSync(dir)
      .some((f) => f.startsWith(`tasks-${day}-`) && f.endsWith(".md"));
    if (exists) return;
    fs.copyFileSync(dataFile, path.join(dir, `tasks-${stamp}.md`));
    pruneBackups(dir);
  } catch {
    /* 备份失败不影响主流程 */
  }
}

export type Priority = "none" | "low" | "medium" | "high";

/** 重复周期：daily 每天 / weekly 每周 / weekday 每个工作日 */
export type Recur = "daily" | "weekly" | "weekday";

export interface SubTask {
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  /** 子待办列表；非空时内容区域以清单模式展示 */
  subtasks: SubTask[];
  /** YYYY-MM-DD，null 表示无日期 */
  date: string | null;
  priority: Priority;
  /** 标签列表，如 ["工作", "学习"] */
  tags: string[];
  done: boolean;
  /** "YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm"，未完成时为 null */
  completedAt: string | null;
  /** 重复周期；null/undefined 为不重复。完成时自动生成下一次 */
  recur?: Recur | null;
  /** 图片文件名列表（存于 data/images/ 目录） */
  images?: string[];
}

const PRIORITY_MARK: Record<Exclude<Priority, "none">, string> = {
  high: "!高",
  medium: "!中",
  low: "!低",
};

const MARK_PRIORITY: Record<string, Priority> = {
  高: "high",
  中: "medium",
  低: "low",
};

const FILE_HEADER = `# 日程待办清单

<!--
  本文件由「日程待办」应用维护，内容为明文 Markdown，可直接被 Agent 工具读取或按以下格式编辑：
  - [ ] 任务标题 !高|!中|!低 #标签1 #标签2 📅YYYY-MM-DD <!-- id:xxx -->
    缩进的行是任务正文描述（可选，可多行）
    - [ ] 缩进的复选行是子待办（可选，与正文二选一）
  - [x] 已完成任务 ... ✅YYYY-MM-DD <!-- id:xxx -->
-->
`;

function serializeBody(t: Task): string[] {
  const lines: string[] = [];
  for (const line of t.description.split("\n")) {
    if (line.trim()) lines.push(`  ${line.trimEnd()}`);
  }
  for (const s of t.subtasks ?? []) {
    if (s.title.trim()) lines.push(`  - [${s.done ? "x" : " "}] ${sanitizeInline(s.title)}`);
  }
  for (const img of t.images ?? []) {
    lines.push(`  ![img](images/${img})`);
  }
  return lines;
}

function sanitizeInline(text: string): string {
  return text.replace(/<!--/g, "<!-").replace(/\s*\n\s*/g, " ").trim();
}

function sanitizeTag(tag: string): string {
  return tag.replace(/[#\s]+/g, "").trim();
}

function taskLine(t: Task): string {
  const parts: string[] = [t.done ? "- [x]" : "- [ ]", sanitizeInline(t.title)];
  if (t.priority !== "none") parts.push(PRIORITY_MARK[t.priority]);
  for (const tag of t.tags ?? []) {
    const clean = sanitizeTag(tag);
    if (clean) parts.push(`#${clean}`);
  }
  if (t.date) parts.push(`📅${t.date}`);
  if (t.done && t.completedAt) parts.push(`✅${t.completedAt}`);
  if (t.recur) parts.push(`🔁${t.recur}`);
  parts.push(`<!-- id:${t.id} -->`);
  return parts.join(" ");
}

const PRIORITY_WEIGHT: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };

function sortActive(a: Task, b: Task): number {
  if (a.date === null && b.date !== null) return 1;
  if (a.date !== null && b.date === null) return -1;
  if (a.date !== b.date) return (a.date ?? "").localeCompare(b.date ?? "");
  const w = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  if (w !== 0) return w;
  return a.title.localeCompare(b.title, "zh-CN");
}

export function serializeTasks(tasks: Task[]): string {
  const active = tasks.filter((t) => !t.done).sort(sortActive);
  const done = tasks
    .filter((t) => t.done)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  const out: string[] = [FILE_HEADER, "", "## 进行中", ""];

  let currentDate: string | null | undefined = undefined;
  for (const t of active) {
    if (t.date !== currentDate) {
      currentDate = t.date;
      out.push(`### ${t.date ?? "无日期"}`, "");
    }
    out.push(taskLine(t), ...serializeBody(t));
  }

  out.push("", "## 已完成", "");
  for (const t of done) {
    out.push(taskLine(t), ...serializeBody(t));
  }
  out.push("");
  return out.join("\n");
}

const TASK_RE = /^- \[( |x)\] (.*) <!-- id:([A-Za-z0-9-]+) -->\s*$/;

export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = [];
  let current: Task | null = null;

  for (const rawLine of markdown.split("\n")) {
    const m = rawLine.match(TASK_RE);
    if (m) {
      let body = m[2];
      const task: Task = {
        id: m[3],
        title: "",
        description: "",
        subtasks: [],
        date: null,
        priority: "none",
        tags: [],
        done: m[1] === "x",
        completedAt: null,
        recur: null,
      };
      const dateM = body.match(/📅(\d{4}-\d{2}-\d{2})/);
      if (dateM) {
        task.date = dateM[1];
        body = body.replace(dateM[0], "");
      }
      const doneM = body.match(/✅(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/);
      if (doneM) {
        task.completedAt = doneM[2] ? `${doneM[1]} ${doneM[2]}` : doneM[1];
        body = body.replace(doneM[0], "");
      }
      const priM = body.match(/!(高|中|低)/);
      if (priM) {
        task.priority = MARK_PRIORITY[priM[1]];
        body = body.replace(priM[0], "");
      }
      const recurM = body.match(/🔁(daily|weekly|weekday)/);
      if (recurM) {
        task.recur = recurM[1] as Recur;
        body = body.replace(recurM[0], "");
      }
      body = body.replace(/#([^\s#]+)/g, (_, name: string) => {
        task.tags.push(name);
        return "";
      });
      task.title = body.replace(/\s+/g, " ").trim();
      tasks.push(task);
      current = task;
    } else if (current && /^ {2}- \[( |x)\] (\S.*)$/.test(rawLine)) {
      // 缩进的复选行：子待办
      const sm = rawLine.match(/^ {2}- \[( |x)\] (\S.*)$/)!;
      current.subtasks.push({ title: sm[2].trim(), done: sm[1] === "x" });
    } else if (current && /^ {2}!\[img\]\(images\/(\S+)\)\s*$/.test(rawLine)) {
      // 缩进的图片引用行
      const im = rawLine.match(/^ {2}!\[img\]\(images\/(\S+)\)\s*$/)!;
      current.images = current.images ?? [];
      current.images.push(im[1]);
    } else if (current && /^ {2}\S/.test(rawLine)) {
      // 缩进行：任务正文描述
      current.description = current.description
        ? current.description + "\n" + rawLine.trimEnd().slice(2)
        : rawLine.trimEnd().slice(2);
    }
  }
  return tasks;
}

export function readTasks(file: string): Task[] {
  if (!fs.existsSync(file)) {
    writeTasks(file, []);
    return [];
  }
  return parseTasks(fs.readFileSync(file, "utf8"));
}

export function writeTasks(file: string, tasks: Task[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, serializeTasks(tasks), "utf8");
  fs.renameSync(tmp, file);
}
