import type { IncomingMessage, ServerResponse } from "http";
import fs from "node:fs";
import path from "node:path";
import {
  backupDaily,
  readTasks,
  writeTasks,
  type Priority,
  type Recur,
  type SubTask,
  type Task,
} from "./markdownStore";
import { AiError, analyzeTaskText } from "./ai";

/** 数据文件的最后修改时间（毫秒），不存在时为 0；用于前端轮询感知外部改动 */
function fileMtime(dataFile: string): number {
  try {
    return fs.statSync(dataFile).mtimeMs;
  } catch {
    return 0;
  }
}

const PRIORITIES: Priority[] = ["none", "low", "medium", "high"];
const RECURS: Recur[] = ["daily", "weekly", "weekday"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** YYYY-MM-DD HH:mm，用于完成时间记录 */
function nowDateTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${todayStr()} ${hh}:${mi}`;
}

function newId(): string {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toLowerCase();
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) reject(new Error("请求体过大"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

interface TaskInput {
  title?: unknown;
  description?: unknown;
  subtasks?: unknown;
  date?: unknown;
  priority?: unknown;
  tags?: unknown;
  done?: unknown;
  recur?: unknown;
  images?: unknown;
}

/** 校验图片文件名列表 */
function sanitizeImages(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const clean = input
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]+\.(png|jpg|jpeg|gif|webp)$/i.test(s));
  return clean.length > 0 ? clean : undefined;
}

function sanitizeSubtasks(input: unknown): SubTask[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (s): s is { title: string; done?: unknown } =>
        !!s && typeof s === "object" && typeof (s as { title?: unknown }).title === "string"
    )
    .map((s) => ({ title: (s.title as string).replace(/\s*\n\s*/g, " ").trim(), done: s.done === true }))
    .filter((s) => s.title);
}

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const tags = [
    ...new Set(
      input
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.replace(/[#\s]+/g, "").trim())
        .filter(Boolean)
    ),
  ];
  // 「日常工作」与其他手动标签互斥：共存时保留其他标签（与前端 enforceDailyExclusive 一致）
  if (tags.length > 1 && tags.includes("日常工作")) {
    return tags.filter((t) => t !== "日常工作");
  }
  return tags;
}

function validateDate(input: unknown): string | null {
  if (typeof input === "string" && DATE_RE.test(input)) return input;
  return null;
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;

function validateDateTime(input: unknown): string | null {
  if (typeof input === "string" && DATETIME_RE.test(input)) return input;
  return null;
}

function validatePriority(input: unknown): Priority {
  return PRIORITIES.includes(input as Priority) ? (input as Priority) : "none";
}

function validateRecur(input: unknown): Recur | null {
  return RECURS.includes(input as Recur) ? (input as Recur) : null;
}

/** 计算重复任务的下一次日期（基于原日期顺延，跨过已过去的周期，保证落在未来） */
function nextRecurDate(date: string | null, recur: Recur): string {
  const t = todayStr();
  const base = date ?? t;
  const d = new Date(base + "T00:00:00");
  const fmt = (x: Date): string => {
    const mm = String(x.getMonth() + 1).padStart(2, "0");
    const dd = String(x.getDate()).padStart(2, "0");
    return `${x.getFullYear()}-${mm}-${dd}`;
  };
  const step = () => {
    if (recur === "daily") d.setDate(d.getDate() + 1);
    else if (recur === "weekly") d.setDate(d.getDate() + 7);
    else {
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
    }
  };
  step();
  while (fmt(d) <= t) step();
  return fmt(d);
}

/** 完成任务时若是重复任务，生成下一次实例（追加到列表，新 ID、未重置的子待办） */
function spawnRecurInstance(task: Task): Task | null {
  if (!task.recur) return null;
  return {
    ...task,
    id: newId(),
    date: nextRecurDate(task.date, task.recur),
    done: false,
    completedAt: null,
    subtasks: (task.subtasks ?? []).map((s) => ({ ...s, done: false })),
  };
}

/** 校验并规范化外部传入的完整任务对象（PUT 全量替换用） */
function normalizeTask(input: unknown): Task | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (typeof o.title !== "string" || !o.title.trim()) return null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : newId(),
    title: o.title.trim(),
    description: typeof o.description === "string" ? o.description : "",
    subtasks: sanitizeSubtasks(o.subtasks),
    date: validateDate(o.date),
    priority: validatePriority(o.priority),
    tags: sanitizeTags(o.tags),
    done: o.done === true,
    completedAt: validateDateTime(o.completedAt),
    recur: validateRecur(o.recur),
    images: sanitizeImages(o.images),
  };
}

function sortByDate(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.date === null && b.date !== null) return 1;
    if (a.date !== null && b.date === null) return -1;
    return (a.date ?? "").localeCompare(b.date ?? "");
  });
}

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * 任务清单 REST API 处理器。
 * 挂载于 /api/tasks，req.url 为去掉前缀后的路径。
 */
export function createTasksApiHandler(dataFile: string) {
  // 启动备份：进程启动（或跨天运行后首次请求）时，若当日尚无备份则建一份
  backupDaily(dataFile);

  /** 写入并确保当日备份存在（原子写后复制，成本极低） */
  const writeWithBackup = (tasks: Task[]): void => {
    writeTasks(dataFile, tasks);
    backupDaily(dataFile);
  };

  return function handler(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): void {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = (req.url ?? "/").split("?")[0];
    const segments = url.split("/").filter(Boolean).map(decodeURIComponent);
    const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");

    const respond = (status: number, body: unknown) => send(res, status, body);

    (async () => {
      const method = req.method ?? "GET";

      // ---------- 集合级静态路由 ----------
      if (segments[0] === "version" && method === "GET") {
        return respond(200, { mtime: fileMtime(dataFile) });
      }

      if (segments[0] === "today" && method === "GET") {
        const t = todayStr();
        let tasks = readTasks(dataFile).filter((x) => !x.done && x.date === t);
        if (query.get("includeOverdue") === "1") {
          tasks = readTasks(dataFile).filter(
            (x) => !x.done && x.date !== null && x.date <= t
          );
        }
        return respond(200, { date: t, count: tasks.length, tasks: sortByDate(tasks) });
      }

      if (segments[0] === "completed" && method === "GET") {
        const tasks = readTasks(dataFile)
          .filter((x) => x.done)
          .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
        return respond(200, { count: tasks.length, tasks });
      }

      if (segments[0] === "week" && method === "GET") {
        const t = todayStr();
        const end = plusDays(6);
        const tasks = readTasks(dataFile).filter(
          (x) => !x.done && x.date !== null && x.date >= t && x.date <= end
        );
        return respond(200, { from: t, to: end, count: tasks.length, tasks: sortByDate(tasks) });
      }

      if (segments[0] === "overdue" && method === "GET") {
        const t = todayStr();
        const tasks = readTasks(dataFile).filter(
          (x) => !x.done && x.date !== null && x.date < t
        );
        return respond(200, { count: tasks.length, tasks: sortByDate(tasks) });
      }

      // 周完成统计：按 ISO 周（周一为起）聚合已完成任务，供周报/工作总结流程使用
      if (segments[0] === "stats" && segments[1] === "weekly" && method === "GET") {
        const weeks = new Map<string, { weekStart: string; weekEnd: string; count: number; tasks: Task[] }>();
        for (const task of readTasks(dataFile)) {
          if (!task.done || !task.completedAt) continue;
          const d = new Date(task.completedAt.slice(0, 10) + "T00:00:00");
          if (isNaN(d.getTime())) continue;
          // ISO 周起（周一）
          const day = d.getDay() === 0 ? 7 : d.getDay();
          const start = new Date(d);
          start.setDate(d.getDate() - day + 1);
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          const fmt = (x: Date): string => {
            const mm = String(x.getMonth() + 1).padStart(2, "0");
            const dd = String(x.getDate()).padStart(2, "0");
            return `${x.getFullYear()}-${mm}-${dd}`;
          };
          const key = fmt(start);
          if (!weeks.has(key)) weeks.set(key, { weekStart: fmt(start), weekEnd: fmt(end), count: 0, tasks: [] });
          const w = weeks.get(key)!;
          w.count++;
          w.tasks.push(task);
        }
        const result = [...weeks.values()]
          .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
          .map((w) => ({
            ...w,
            tasks: w.tasks.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
          }));
        return respond(200, { weeks: result });
      }

      if (segments[0] === "tag" && method === "GET") {
        const tag = segments[1];
        if (!tag) return respond(400, { error: "缺少标签名，用法: GET /api/tasks/tag/工作" });
        const tasks = readTasks(dataFile).filter(
          (x) => !x.done && (x.tags ?? []).includes(tag)
        );
        return respond(200, { tag, count: tasks.length, tasks: sortByDate(tasks) });
      }

      if (segments[0] === "tags" && method === "GET") {
        const count = new Map<string, number>();
        for (const t of readTasks(dataFile)) {
          if (t.done) continue;
          for (const tag of t.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1);
        }
        const tags = [...count.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([tag, n]) => ({ tag, count: n }));
        return respond(200, { tags });
      }

      // ---------- AI 分析建待办（Tendedero 等外部工具传入原文 → AI 提炼 → 建待办） ----------
      if (segments[0] === "analyze" && method === "POST") {
        let body: { text?: unknown; source?: unknown };
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return respond(400, { error: "请求体不是合法 JSON" });
        }
        const rawText = typeof body.text === "string" ? body.text : "";
        const text = rawText.trim();
        if (!text) return respond(400, { error: "text 不能为空" });
        if (text.length > 5000) return respond(400, { error: "text 超长（上限 5000 字符）" });
        const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : null;
        const t = todayStr();

        // 收集当前已有标签（未完成任务中去重），供模型只从中匹配
        const existingTags = [...new Set(
          readTasks(dataFile)
            .filter((x) => !x.done)
            .flatMap((x) => x.tags ?? [])
        )].sort();

        let analysis;
        try {
          analysis = await analyzeTaskText(text, t, existingTags);
        } catch (e) {
          if (e instanceof AiError) return respond(500, { error: `AI 分析失败：${e.message}` });
          throw e;
        }

        // 降级：模型输出无法解析时，用原文首行作 title，其余留空，仍成功建待办
        const fallbackTitle = text.split("\n").map((l) => l.trim()).find(Boolean) ?? text.slice(0, 30);
        const a = analysis ?? {
          title: fallbackTitle.slice(0, 30),
          subtasks: [] as string[],
          tags: [] as string[],
          date: null as string | null,
          priority: "none" as Priority,
        };
        const description = source ? `来源：${source}\n\n${text}` : text;
        // 标签规则：只保留已有标签中匹配到的 + 强制添加来源标签
        const matchedTags = sanitizeTags(a.tags).filter((tag) => existingTags.includes(tag));
        const sourceTag = source ?? "Tendedero";
        const task: Task = {
          id: newId(),
          title: a.title,
          description,
          subtasks: a.subtasks.map((s) => ({ title: s, done: false })),
          date: a.date,
          priority: a.priority,
          tags: [...new Set([sourceTag, ...matchedTags])],
          done: false,
          completedAt: null,
          recur: null,
        };
        const tasks = readTasks(dataFile);
        tasks.push(task);
        writeWithBackup(tasks);
        return respond(201, {
          ok: true,
          task,
          analysis: { title: a.title, subtasks: a.subtasks, tags: a.tags, date: a.date, priority: a.priority },
          degraded: analysis === null,
        });
      }

      // ---------- 集合路由 /api/tasks ----------
      if (segments.length === 0) {
        if (method === "GET") {
          return respond(200, { file: dataFile, mtime: fileMtime(dataFile), tasks: readTasks(dataFile) });
        }

        if (method === "POST") {
          const body = JSON.parse(await readBody(req)) as TaskInput;
          if (typeof body.title !== "string" || !body.title.trim()) {
            return respond(400, { error: "title 必填且不能为空" });
          }
          const task: Task = {
            id: newId(),
            title: body.title.trim(),
            description: typeof body.description === "string" ? body.description : "",
            subtasks: sanitizeSubtasks(body.subtasks),
            date: validateDate(body.date),
            priority: validatePriority(body.priority),
            tags: sanitizeTags(body.tags),
            done: false,
            completedAt: null,
            recur: validateRecur(body.recur),
            images: sanitizeImages(body.images),
          };
          const tasks = readTasks(dataFile);
          tasks.push(task);
          writeWithBackup(tasks);
          return respond(201, { ok: true, task });
        }

        if (method === "PUT") {
          const body = JSON.parse(await readBody(req));
          if (!body || !Array.isArray(body.tasks)) {
            return respond(400, { error: "期望格式: { tasks: Task[] }" });
          }
          // 乐观锁：调用方传入读取时的文件版本 baseMtime，
          // 若期间文件被外部（Agent 工具等）修改，拒绝覆盖并返回最新数据
          const currentMtime = fileMtime(dataFile);
          const baseMtime = typeof body.baseMtime === "number" ? body.baseMtime : null;
          if (baseMtime !== null && Math.abs(currentMtime - baseMtime) > 1) {
            return respond(409, {
              error: "数据已被外部修改，请基于最新数据重试",
              mtime: currentMtime,
              tasks: readTasks(dataFile),
            });
          }
          const tasks = (body.tasks as unknown[]).map(normalizeTask);
          if (tasks.some((t) => t === null)) {
            return respond(400, { error: "tasks 中存在非法任务对象（title 必填）" });
          }
          writeWithBackup(tasks as Task[]);
          return respond(200, { ok: true, file: dataFile, count: tasks.length, mtime: fileMtime(dataFile) });
        }
      }

      // ---------- 单任务路由 /api/tasks/:id ----------
      if (segments.length >= 1) {
        const id = segments[0];
        const tasks = readTasks(dataFile);
        const idx = tasks.findIndex((x) => x.id === id);
        const action = segments[1];

        if (method === "POST" && (action === "complete" || action === "uncomplete")) {
          if (idx === -1) return respond(404, { error: `任务不存在: ${id}` });
          const done = action === "complete";
          const wasDone = tasks[idx].done;
          tasks[idx] = {
            ...tasks[idx],
            done,
            completedAt: done ? nowDateTime() : null,
          };
          // 重复任务：从未完成变为完成时生成下一次实例
          let spawned: Task | null = null;
          if (done && !wasDone) {
            spawned = spawnRecurInstance(tasks[idx]);
            if (spawned) tasks.push(spawned);
          }
          writeWithBackup(tasks);
          return respond(200, { ok: true, task: tasks[idx], spawned });
        }

        if (segments.length > 1) return next();

        if (method === "GET") {
          if (idx === -1) return respond(404, { error: `任务不存在: ${id}` });
          return respond(200, { task: tasks[idx] });
        }

        if (method === "PATCH") {
          if (idx === -1) return respond(404, { error: `任务不存在: ${id}` });
          const body = JSON.parse(await readBody(req)) as TaskInput;
          const cur = tasks[idx];
          const next2: Task = { ...cur };
          if (body.title !== undefined) {
            if (typeof body.title !== "string" || !body.title.trim()) {
              return respond(400, { error: "title 不能为空" });
            }
            next2.title = body.title.trim();
          }
          if (body.description !== undefined) {
            next2.description = typeof body.description === "string" ? body.description : "";
          }
          if (body.subtasks !== undefined) next2.subtasks = sanitizeSubtasks(body.subtasks);
          if (body.date !== undefined) {
            if (body.date !== null && !validateDate(body.date)) {
              return respond(400, { error: "date 格式应为 YYYY-MM-DD 或 null" });
            }
            next2.date = validateDate(body.date);
          }
          if (body.priority !== undefined) {
            if (!PRIORITIES.includes(body.priority as Priority)) {
              return respond(400, { error: `priority 可选值: ${PRIORITIES.join("/")}` });
            }
            next2.priority = body.priority as Priority;
          }
          if (body.tags !== undefined) next2.tags = sanitizeTags(body.tags);
          if (body.recur !== undefined) {
            if (body.recur !== null && !RECURS.includes(body.recur as Recur)) {
              return respond(400, { error: `recur 可选值: ${RECURS.join("/")} 或 null` });
            }
            next2.recur = validateRecur(body.recur);
          }
          if (body.images !== undefined) next2.images = sanitizeImages(body.images);
          if (body.done !== undefined) {
            next2.done = body.done === true;
            next2.completedAt = next2.done ? nowDateTime() : null;
          }
          tasks[idx] = next2;
          // 重复任务：经 PATCH 从未完成变为完成时同样生成下一次实例
          let spawned: Task | null = null;
          if (body.done === true && !cur.done) {
            spawned = spawnRecurInstance(next2);
            if (spawned) tasks.push(spawned);
          }
          writeWithBackup(tasks);
          return respond(200, { ok: true, task: next2, spawned });
        }

        if (method === "DELETE") {
          if (idx === -1) return respond(404, { error: `任务不存在: ${id}` });
          const [removed] = tasks.splice(idx, 1);
          writeWithBackup(tasks);
          return respond(200, { ok: true, removed });
        }
      }

      return next();
    })().catch((e) => {
      if (e instanceof SyntaxError) {
        respond(400, { error: "请求体不是合法 JSON" });
      } else {
        respond(500, { error: String(e) });
      }
    });
  };
}

/**
 * 图片上传/访问 API 处理器。
 * 挂载于 /api/images，req.url 为去掉前缀后的路径（/ 或 /:filename）。
 */
export function createImagesApiHandler(dataFile: string) {
  const imagesDir = path.join(path.dirname(dataFile), "images");

  return function handler(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): void {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = (req.url ?? "/").split("?")[0];
    const segments = url.split("/").filter(Boolean).map(decodeURIComponent);
    const respond = (status: number, body: unknown) => send(res, status, body);

    (async () => {
      const method = req.method ?? "GET";

      // GET /:filename — 提供图片文件
      if (method === "GET" && segments.length === 1) {
        const name = segments[0];
        if (!/^[A-Za-z0-9_-]+\.(png|jpg|jpeg|gif|webp)$/i.test(name)) {
          return respond(400, { error: "非法文件名" });
        }
        const filePath = path.join(imagesDir, name);
        if (!fs.existsSync(filePath)) {
          return respond(404, { error: "图片不存在" });
        }
        const ext = path.extname(name).toLowerCase();
        const mime: Record<string, string> = {
          ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".gif": "image/gif", ".webp": "image/webp",
        };
        res.statusCode = 200;
        res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // POST / — 上传图片（base64），返回文件名
      if (method === "POST" && segments.length === 0) {
        let body: { data?: unknown; name?: unknown };
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return respond(400, { error: "请求体不是合法 JSON" });
        }
        const b64 = typeof body.data === "string" ? body.data : "";
        if (!b64) return respond(400, { error: "data 不能为空（base64）" });
        const buf = Buffer.from(b64, "base64");
        if (buf.length > 5 * 1024 * 1024) return respond(400, { error: "图片超过 5MB 限制" });

        const ext = typeof body.name === "string"
          ? (path.extname(body.name).toLowerCase() || ".png")
          : ".png";
        const allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
        const safeExt = allowed.includes(ext) ? ext : ".png";
        const filename = `${newId()}${safeExt}`;

        fs.mkdirSync(imagesDir, { recursive: true });
        fs.writeFileSync(path.join(imagesDir, filename), buf);
        return respond(201, { ok: true, filename });
      }

      return next();
    })().catch((e) => {
      if (e instanceof SyntaxError) {
        respond(400, { error: "请求体不是合法 JSON" });
      } else {
        respond(500, { error: String(e) });
      }
    });
  };
}
