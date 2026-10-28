var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server/api.ts
var api_exports = {};
__export(api_exports, {
  createImagesApiHandler: () => createImagesApiHandler,
  createTasksApiHandler: () => createTasksApiHandler
});
module.exports = __toCommonJS(api_exports);
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);

// server/markdownStore.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var MAX_BACKUPS = 30;
function backupStamp() {
  const d = /* @__PURE__ */ new Date();
  const p = (n) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return { day, stamp: `${day}-${p(d.getHours())}${p(d.getMinutes())}` };
}
function pruneBackups(dir) {
  try {
    const files = import_node_fs.default.readdirSync(dir).filter((f) => /^tasks-\d{8}-\d{4}\.md$/.test(f)).sort();
    while (files.length > MAX_BACKUPS) {
      const f = files.shift();
      try {
        import_node_fs.default.unlinkSync(import_node_path.default.join(dir, f));
      } catch {
      }
    }
  } catch {
  }
}
function backupDaily(dataFile) {
  try {
    if (!import_node_fs.default.existsSync(dataFile)) return;
    const { day, stamp } = backupStamp();
    const dir = import_node_path.default.join(import_node_path.default.dirname(dataFile), "backups");
    import_node_fs.default.mkdirSync(dir, { recursive: true });
    const exists = import_node_fs.default.readdirSync(dir).some((f) => f.startsWith(`tasks-${day}-`) && f.endsWith(".md"));
    if (exists) return;
    import_node_fs.default.copyFileSync(dataFile, import_node_path.default.join(dir, `tasks-${stamp}.md`));
    pruneBackups(dir);
  } catch {
  }
}
var PRIORITY_MARK = {
  high: "!\u9AD8",
  medium: "!\u4E2D",
  low: "!\u4F4E"
};
var MARK_PRIORITY = {
  \u9AD8: "high",
  \u4E2D: "medium",
  \u4F4E: "low"
};
var FILE_HEADER = `# \u65E5\u7A0B\u5F85\u529E\u6E05\u5355

<!--
  \u672C\u6587\u4EF6\u7531\u300C\u65E5\u7A0B\u5F85\u529E\u300D\u5E94\u7528\u7EF4\u62A4\uFF0C\u5185\u5BB9\u4E3A\u660E\u6587 Markdown\uFF0C\u53EF\u76F4\u63A5\u88AB Agent \u5DE5\u5177\u8BFB\u53D6\u6216\u6309\u4EE5\u4E0B\u683C\u5F0F\u7F16\u8F91\uFF1A
  - [ ] \u4EFB\u52A1\u6807\u9898 !\u9AD8|!\u4E2D|!\u4F4E #\u6807\u7B7E1 #\u6807\u7B7E2 \u{1F4C5}YYYY-MM-DD <!-- id:xxx -->
    \u7F29\u8FDB\u7684\u884C\u662F\u4EFB\u52A1\u6B63\u6587\u63CF\u8FF0\uFF08\u53EF\u9009\uFF0C\u53EF\u591A\u884C\uFF09
    - [ ] \u7F29\u8FDB\u7684\u590D\u9009\u884C\u662F\u5B50\u5F85\u529E\uFF08\u53EF\u9009\uFF0C\u4E0E\u6B63\u6587\u4E8C\u9009\u4E00\uFF09
  - [x] \u5DF2\u5B8C\u6210\u4EFB\u52A1 ... \u2705YYYY-MM-DD <!-- id:xxx -->
-->
`;
function serializeBody(t) {
  const lines = [];
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
function sanitizeInline(text) {
  return text.replace(/<!--/g, "<!-").replace(/\s*\n\s*/g, " ").trim();
}
function sanitizeTag(tag) {
  return tag.replace(/[#\s]+/g, "").trim();
}
function taskLine(t) {
  const parts = [t.done ? "- [x]" : "- [ ]", sanitizeInline(t.title)];
  if (t.priority !== "none") parts.push(PRIORITY_MARK[t.priority]);
  for (const tag of t.tags ?? []) {
    const clean = sanitizeTag(tag);
    if (clean) parts.push(`#${clean}`);
  }
  if (t.date) parts.push(`\u{1F4C5}${t.date}`);
  if (t.done && t.completedAt) parts.push(`\u2705${t.completedAt}`);
  if (t.recur) parts.push(`\u{1F501}${t.recur}`);
  parts.push(`<!-- id:${t.id} -->`);
  return parts.join(" ");
}
var PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2, none: 3 };
function sortActive(a, b) {
  if (a.date === null && b.date !== null) return 1;
  if (a.date !== null && b.date === null) return -1;
  if (a.date !== b.date) return (a.date ?? "").localeCompare(b.date ?? "");
  const w = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  if (w !== 0) return w;
  return a.title.localeCompare(b.title, "zh-CN");
}
function serializeTasks(tasks) {
  const active = tasks.filter((t) => !t.done).sort(sortActive);
  const done = tasks.filter((t) => t.done).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const out = [FILE_HEADER, "", "## \u8FDB\u884C\u4E2D", ""];
  let currentDate = void 0;
  for (const t of active) {
    if (t.date !== currentDate) {
      currentDate = t.date;
      out.push(`### ${t.date ?? "\u65E0\u65E5\u671F"}`, "");
    }
    out.push(taskLine(t), ...serializeBody(t));
  }
  out.push("", "## \u5DF2\u5B8C\u6210", "");
  for (const t of done) {
    out.push(taskLine(t), ...serializeBody(t));
  }
  out.push("");
  return out.join("\n");
}
var TASK_RE = /^- \[( |x)\] (.*) <!-- id:([A-Za-z0-9-]+) -->\s*$/;
function parseTasks(markdown) {
  const tasks = [];
  let current = null;
  for (const rawLine of markdown.split("\n")) {
    const m = rawLine.match(TASK_RE);
    if (m) {
      let body = m[2];
      const task = {
        id: m[3],
        title: "",
        description: "",
        subtasks: [],
        date: null,
        priority: "none",
        tags: [],
        done: m[1] === "x",
        completedAt: null,
        recur: null
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
        task.recur = recurM[1];
        body = body.replace(recurM[0], "");
      }
      body = body.replace(/#([^\s#]+)/g, (_, name) => {
        task.tags.push(name);
        return "";
      });
      task.title = body.replace(/\s+/g, " ").trim();
      tasks.push(task);
      current = task;
    } else if (current && /^ {2}- \[( |x)\] (\S.*)$/.test(rawLine)) {
      const sm = rawLine.match(/^ {2}- \[( |x)\] (\S.*)$/);
      current.subtasks.push({ title: sm[2].trim(), done: sm[1] === "x" });
    } else if (current && /^ {2}!\[img\]\(images\/(\S+)\)\s*$/.test(rawLine)) {
      const im = rawLine.match(/^ {2}!\[img\]\(images\/(\S+)\)\s*$/);
      current.images = current.images ?? [];
      current.images.push(im[1]);
    } else if (current && /^ {2}\S/.test(rawLine)) {
      current.description = current.description ? current.description + "\n" + rawLine.trimEnd().slice(2) : rawLine.trimEnd().slice(2);
    }
  }
  return tasks;
}
function readTasks(file) {
  if (!import_node_fs.default.existsSync(file)) {
    writeTasks(file, []);
    return [];
  }
  return parseTasks(import_node_fs.default.readFileSync(file, "utf8"));
}
function writeTasks(file, tasks) {
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  import_node_fs.default.writeFileSync(tmp, serializeTasks(tasks), "utf8");
  import_node_fs.default.renameSync(tmp, file);
}

// server/ai.ts
var import_node_child_process = require("node:child_process");
var ENDPOINT = () => (process.env.TODO_AI_ENDPOINT ?? "http://localhost:11434").replace(/\/+$/, "");
var MODEL = () => process.env.TODO_AI_MODEL ?? "deepseek-r1:14b";
var TIMEOUT = () => Number(process.env.TODO_AI_TIMEOUT_MS ?? 12e4);
var SYSTEM_PROMPT = `\u4F60\u662F\u5F85\u529E\u4E8B\u9879\u63D0\u70BC\u52A9\u624B\u3002\u628A\u7528\u6237\u7ED9\u7684\u539F\u6587\u63D0\u70BC\u4E3A\u4E00\u6761\u7ED3\u6784\u5316\u5F85\u529E\u3002
\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u8F93\u51FA\u4EFB\u4F55\u5176\u4ED6\u6587\u5B57\u3001\u89E3\u91CA\u6216 Markdown \u4EE3\u7801\u5757\u3002
\u5B57\u6BB5\uFF1A
- title: \u4E00\u53E5\u8BDD\u6982\u62EC\u4E8B\u9879\uFF0C\u226430 \u5B57\uFF0C\u52A8\u8BCD\u5F00\u5934
- subtasks: \u5B57\u7B26\u4E32\u6570\u7EC4\uFF1B\u539F\u6587\u542B\u591A\u4E2A\u6B65\u9AA4/\u8981\u70B9\u65F6\u9010\u6761\u62C6\u89E3\uFF08\u4E0D\u8981\u5E26\u5E8F\u53F7\uFF09\uFF0C\u5355\u6761\u4E8B\u9879\u4E3A\u7A7A\u6570\u7EC4
- tags: 1-3 \u4E2A\u5206\u7C7B\u6807\u7B7E\u5B57\u7B26\u4E32\u6570\u7EC4\uFF0C\u53C2\u8003\u5E38\u89C1\u4F53\u7CFB\uFF08\u5DE5\u4F5C/\u751F\u6D3B/\u9879\u76EE\u540D\u7B49\uFF09\uFF0C\u53EF\u65B0\u5EFA
- date: YYYY-MM-DD \u6216 null\uFF1B\u539F\u6587\u4E2D\u7684\u76F8\u5BF9\u65E5\u671F\uFF08\u660E\u5929/\u4E0B\u5468\u4E09/\u5468\u4E94\uFF09\u4EE5\u4ECA\u5929\u4E3A\u57FA\u51C6\u6362\u7B97\uFF0C\u65E0\u65F6\u95F4\u4FE1\u606F\u8F93\u51FA null
  \u300C\u4E0B\u5468X\u300D\u6307\u4E0B\u4E00\u4E2A\u5B8C\u6574\u81EA\u7136\u5468\u7684\u5468X\uFF0C\u4E0D\u662F\u4ECE\u4ECA\u5929\u8D77\u7684\u7B2C7\u5929\uFF1B\u300C\u8FD9/\u672C\u5468X\u300D\u6307\u5F53\u524D\u81EA\u7136\u5468\u7684\u5468X
- priority: none/low/medium/high \u4E4B\u4E00\uFF1B\u9ED8\u8BA4 none\uFF1B\u539F\u6587\u542B"\u7D27\u6025""\u5C3D\u5FEB""\u91CD\u8981"\u7B49\u63D0\u5347
\u62FF\u4E0D\u51C6\u7684\u5B57\u6BB5\u5B81\u53EF\u7559\u7A7A\uFF08date=null\u3001tags=[]\uFF09\uFF0C\u4E0D\u8981\u7F16\u9020\u3002`;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function weekdayLabel(dateStr) {
  const labels = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
  const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
  return labels[d.getDay()];
}
var PRIORITIES = ["none", "low", "medium", "high"];
function extractJson(raw) {
  const t = raw.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : t;
  try {
    const v = JSON.parse(candidate);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    const m = candidate.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const v = JSON.parse(m[0]);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
}
function normalizeAnalysis(o) {
  const str = (v) => typeof v === "string" ? v.trim() : "";
  const strArr = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
  const date = str(o.date);
  const pr = str(o.priority).toLowerCase();
  return {
    title: str(o.title),
    subtasks: strArr(o.subtasks),
    tags: strArr(o.tags).map((t) => t.replace(/^[#\s]+/, "")).filter(Boolean).slice(0, 3),
    date: DATE_RE.test(date) ? date : null,
    priority: PRIORITIES.includes(pr) ? pr : "none"
  };
}
var AiError = class extends Error {
};
var ensureServePromise = null;
async function isServeUp() {
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
function ensureServe() {
  if (ensureServePromise) return ensureServePromise;
  ensureServePromise = (async () => {
    if (await isServeUp()) return;
    let child;
    try {
      child = (0, import_node_child_process.spawn)("ollama", ["serve"], { detached: true, stdio: "ignore" });
      child.unref();
    } catch (e) {
      throw new AiError(`\u65E0\u6CD5\u62C9\u8D77\u672C\u5730 Ollama\uFF1A${e instanceof Error ? e.message : String(e)}\uFF08\u8BF7\u786E\u8BA4\u5DF2\u5B89\u88C5 Ollama\uFF09`);
    }
    child.on("error", () => {
    });
    const deadline = Date.now() + 2e4;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isServeUp()) return;
    }
    throw new AiError("Ollama serve \u62C9\u8D77\u540E 20s \u5185\u672A\u5C31\u7EEA");
  })().finally(() => {
    ensureServePromise = null;
  });
  return ensureServePromise;
}
function preResolveDate(text, today) {
  const t = /* @__PURE__ */ new Date(today + "T00:00:00");
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  if (/大后天/.test(text)) return fmt(addDays(t, 3));
  if (/后天/.test(text)) return fmt(addDays(t, 2));
  if (/明天/.test(text)) return fmt(addDays(t, 1));
  if (/今天/.test(text)) return fmt(t);
  const WEEKDAYS = { \u65E5: 0, \u5929: 0, \u4E00: 1, \u4E8C: 2, \u4E09: 3, \u56DB: 4, \u4E94: 5, \u516D: 6 };
  const m = text.match(/(下下|下|这|本)?周([日天一二三四五六])/) ?? text.match(/(下下|下|这|本)?星期([日天一二三四五六])/);
  if (m) {
    const prefix = m[1] ?? "";
    const targetDay = WEEKDAYS[m[2]];
    const todayDay = t.getDay();
    let diff = targetDay - todayDay;
    if (prefix === "\u4E0B") diff += 7;
    else if (prefix === "\u4E0B\u4E0B") diff += 14;
    else if (prefix === "" && diff <= 0) diff += 7;
    return fmt(addDays(t, diff));
  }
  return null;
}
function buildUserPrompt(text, today, existingTags) {
  let p = `\u4ECA\u5929\u662F ${today}\uFF08${weekdayLabel(today)}\uFF09\u3002`;
  if (existingTags && existingTags.length > 0) {
    p += `
\u5DF2\u6709\u6807\u7B7E\u5217\u8868\uFF1A${existingTags.join("\u3001")}\u3002tags \u5B57\u6BB5\u53EA\u80FD\u4ECE\u8BE5\u5217\u8868\u4E2D\u9009\u53D6\u5339\u914D\u7684\u6807\u7B7E\uFF0C\u4E0D\u8981\u521B\u5EFA\u65B0\u6807\u7B7E\uFF1B\u65E0\u5339\u914D\u5219\u8F93\u51FA\u7A7A\u6570\u7EC4\u3002`;
  } else {
    p += `
tags \u5B57\u6BB5\u8F93\u51FA\u7A7A\u6570\u7EC4\uFF08\u5F53\u524D\u65E0\u5DF2\u6709\u6807\u7B7E\u53EF\u5339\u914D\uFF09\u3002`;
  }
  p += `
\u539F\u6587\uFF1A${text}`;
  return p;
}
async function analyzeTaskText(text, today, existingTags) {
  await ensureServe();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT());
  let raw;
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
          { role: "user", content: buildUserPrompt(text, today, existingTags) }
        ]
      })
    });
    if (!res.ok) throw new AiError(`Ollama \u8FD4\u56DE ${res.status}`);
    const data = await res.json();
    raw = data.message?.content ?? "";
  } catch (e) {
    if (e instanceof AiError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new AiError(
      msg.includes("abort") ? `AI \u5206\u6790\u8D85\u65F6\uFF08>${TIMEOUT()}ms\uFF09` : `AI \u670D\u52A1\u8C03\u7528\u5931\u8D25\uFF1A${msg}`
    );
  } finally {
    clearTimeout(timer);
  }
  const parsed = extractJson(raw);
  if (!parsed) return null;
  const a = normalizeAnalysis(parsed);
  const localDate = preResolveDate(text, today);
  if (localDate) a.date = localDate;
  return a.title ? a : null;
}

// server/api.ts
function fileMtime(dataFile) {
  try {
    return import_node_fs2.default.statSync(dataFile).mtimeMs;
  } catch {
    return 0;
  }
}
var PRIORITIES2 = ["none", "low", "medium", "high"];
var RECURS = ["daily", "weekly", "weekday"];
var DATE_RE2 = /^\d{4}-\d{2}-\d{2}$/;
function todayStr() {
  const d = /* @__PURE__ */ new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function nowDateTime() {
  const d = /* @__PURE__ */ new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${todayStr()} ${hh}:${mi}`;
}
function newId() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toLowerCase();
}
function send(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) reject(new Error("\u8BF7\u6C42\u4F53\u8FC7\u5927"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
function sanitizeImages(input) {
  if (!Array.isArray(input)) return void 0;
  const clean = input.filter((s) => typeof s === "string").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]+\.(png|jpg|jpeg|gif|webp)$/i.test(s));
  return clean.length > 0 ? clean : void 0;
}
function sanitizeSubtasks(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (s) => !!s && typeof s === "object" && typeof s.title === "string"
  ).map((s) => ({ title: s.title.replace(/\s*\n\s*/g, " ").trim(), done: s.done === true })).filter((s) => s.title);
}
function sanitizeTags(input) {
  if (!Array.isArray(input)) return [];
  const tags = [
    ...new Set(
      input.filter((t) => typeof t === "string").map((t) => t.replace(/[#\s]+/g, "").trim()).filter(Boolean)
    )
  ];
  if (tags.length > 1 && tags.includes("\u65E5\u5E38\u5DE5\u4F5C")) {
    return tags.filter((t) => t !== "\u65E5\u5E38\u5DE5\u4F5C");
  }
  return tags;
}
function validateDate(input) {
  if (typeof input === "string" && DATE_RE2.test(input)) return input;
  return null;
}
var DATETIME_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;
function validateDateTime(input) {
  if (typeof input === "string" && DATETIME_RE.test(input)) return input;
  return null;
}
function validatePriority(input) {
  return PRIORITIES2.includes(input) ? input : "none";
}
function validateRecur(input) {
  return RECURS.includes(input) ? input : null;
}
function nextRecurDate(date, recur) {
  const t = todayStr();
  const base = date ?? t;
  const d = /* @__PURE__ */ new Date(base + "T00:00:00");
  const fmt = (x) => {
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
function spawnRecurInstance(task) {
  if (!task.recur) return null;
  return {
    ...task,
    id: newId(),
    date: nextRecurDate(task.date, task.recur),
    done: false,
    completedAt: null,
    subtasks: (task.subtasks ?? []).map((s) => ({ ...s, done: false }))
  };
}
function normalizeTask(input) {
  if (!input || typeof input !== "object") return null;
  const o = input;
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
    images: sanitizeImages(o.images)
  };
}
function sortByDate(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.date === null && b.date !== null) return 1;
    if (a.date !== null && b.date === null) return -1;
    return (a.date ?? "").localeCompare(b.date ?? "");
  });
}
function plusDays(n) {
  const d = /* @__PURE__ */ new Date();
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function createTasksApiHandler(dataFile) {
  backupDaily(dataFile);
  const writeWithBackup = (tasks) => {
    writeTasks(dataFile, tasks);
    backupDaily(dataFile);
  };
  return function handler(req, res, next) {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const url = (req.url ?? "/").split("?")[0];
    const segments = url.split("/").filter(Boolean).map(decodeURIComponent);
    const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    const respond = (status, body) => send(res, status, body);
    (async () => {
      const method = req.method ?? "GET";
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
        const tasks = readTasks(dataFile).filter((x) => x.done).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
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
      if (segments[0] === "stats" && segments[1] === "weekly" && method === "GET") {
        const weeks = /* @__PURE__ */ new Map();
        for (const task of readTasks(dataFile)) {
          if (!task.done || !task.completedAt) continue;
          const d = /* @__PURE__ */ new Date(task.completedAt.slice(0, 10) + "T00:00:00");
          if (isNaN(d.getTime())) continue;
          const day = d.getDay() === 0 ? 7 : d.getDay();
          const start = new Date(d);
          start.setDate(d.getDate() - day + 1);
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          const fmt = (x) => {
            const mm = String(x.getMonth() + 1).padStart(2, "0");
            const dd = String(x.getDate()).padStart(2, "0");
            return `${x.getFullYear()}-${mm}-${dd}`;
          };
          const key = fmt(start);
          if (!weeks.has(key)) weeks.set(key, { weekStart: fmt(start), weekEnd: fmt(end), count: 0, tasks: [] });
          const w = weeks.get(key);
          w.count++;
          w.tasks.push(task);
        }
        const result = [...weeks.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart)).map((w) => ({
          ...w,
          tasks: w.tasks.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
        }));
        return respond(200, { weeks: result });
      }
      if (segments[0] === "tag" && method === "GET") {
        const tag = segments[1];
        if (!tag) return respond(400, { error: "\u7F3A\u5C11\u6807\u7B7E\u540D\uFF0C\u7528\u6CD5: GET /api/tasks/tag/\u5DE5\u4F5C" });
        const tasks = readTasks(dataFile).filter(
          (x) => !x.done && (x.tags ?? []).includes(tag)
        );
        return respond(200, { tag, count: tasks.length, tasks: sortByDate(tasks) });
      }
      if (segments[0] === "tags" && method === "GET") {
        const count = /* @__PURE__ */ new Map();
        for (const t of readTasks(dataFile)) {
          if (t.done) continue;
          for (const tag of t.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1);
        }
        const tags = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, count: n }));
        return respond(200, { tags });
      }
      if (segments[0] === "analyze" && method === "POST") {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return respond(400, { error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON" });
        }
        const rawText = typeof body.text === "string" ? body.text : "";
        const text = rawText.trim();
        if (!text) return respond(400, { error: "text \u4E0D\u80FD\u4E3A\u7A7A" });
        if (text.length > 5e3) return respond(400, { error: "text \u8D85\u957F\uFF08\u4E0A\u9650 5000 \u5B57\u7B26\uFF09" });
        const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : null;
        const t = todayStr();
        const existingTags = [...new Set(
          readTasks(dataFile).filter((x) => !x.done).flatMap((x) => x.tags ?? [])
        )].sort();
        let analysis;
        try {
          analysis = await analyzeTaskText(text, t, existingTags);
        } catch (e) {
          if (e instanceof AiError) return respond(500, { error: `AI \u5206\u6790\u5931\u8D25\uFF1A${e.message}` });
          throw e;
        }
        const fallbackTitle = text.split("\n").map((l) => l.trim()).find(Boolean) ?? text.slice(0, 30);
        const a = analysis ?? {
          title: fallbackTitle.slice(0, 30),
          subtasks: [],
          tags: [],
          date: null,
          priority: "none"
        };
        const description = source ? `\u6765\u6E90\uFF1A${source}

${text}` : text;
        const matchedTags = sanitizeTags(a.tags).filter((tag) => existingTags.includes(tag));
        const sourceTag = source ?? "external";
        const task = {
          id: newId(),
          title: a.title,
          description,
          subtasks: a.subtasks.map((s) => ({ title: s, done: false })),
          date: a.date,
          priority: a.priority,
          tags: [.../* @__PURE__ */ new Set([sourceTag, ...matchedTags])],
          done: false,
          completedAt: null,
          recur: null
        };
        const tasks = readTasks(dataFile);
        tasks.push(task);
        writeWithBackup(tasks);
        return respond(201, {
          ok: true,
          task,
          analysis: { title: a.title, subtasks: a.subtasks, tags: a.tags, date: a.date, priority: a.priority },
          degraded: analysis === null
        });
      }
      if (segments.length === 0) {
        if (method === "GET") {
          return respond(200, { file: dataFile, mtime: fileMtime(dataFile), tasks: readTasks(dataFile) });
        }
        if (method === "POST") {
          const body = JSON.parse(await readBody(req));
          if (typeof body.title !== "string" || !body.title.trim()) {
            return respond(400, { error: "title \u5FC5\u586B\u4E14\u4E0D\u80FD\u4E3A\u7A7A" });
          }
          const task = {
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
            images: sanitizeImages(body.images)
          };
          const tasks = readTasks(dataFile);
          tasks.push(task);
          writeWithBackup(tasks);
          return respond(201, { ok: true, task });
        }
        if (method === "PUT") {
          const body = JSON.parse(await readBody(req));
          if (!body || !Array.isArray(body.tasks)) {
            return respond(400, { error: "\u671F\u671B\u683C\u5F0F: { tasks: Task[] }" });
          }
          const currentMtime = fileMtime(dataFile);
          const baseMtime = typeof body.baseMtime === "number" ? body.baseMtime : null;
          if (baseMtime !== null && Math.abs(currentMtime - baseMtime) > 1) {
            return respond(409, {
              error: "\u6570\u636E\u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u8BF7\u57FA\u4E8E\u6700\u65B0\u6570\u636E\u91CD\u8BD5",
              mtime: currentMtime,
              tasks: readTasks(dataFile)
            });
          }
          const tasks = body.tasks.map(normalizeTask);
          if (tasks.some((t) => t === null)) {
            return respond(400, { error: "tasks \u4E2D\u5B58\u5728\u975E\u6CD5\u4EFB\u52A1\u5BF9\u8C61\uFF08title \u5FC5\u586B\uFF09" });
          }
          writeWithBackup(tasks);
          return respond(200, { ok: true, file: dataFile, count: tasks.length, mtime: fileMtime(dataFile) });
        }
      }
      if (segments.length >= 1) {
        const id = segments[0];
        const tasks = readTasks(dataFile);
        const idx = tasks.findIndex((x) => x.id === id);
        const action = segments[1];
        if (method === "POST" && (action === "complete" || action === "uncomplete")) {
          if (idx === -1) return respond(404, { error: `\u4EFB\u52A1\u4E0D\u5B58\u5728: ${id}` });
          const done = action === "complete";
          const wasDone = tasks[idx].done;
          tasks[idx] = {
            ...tasks[idx],
            done,
            completedAt: done ? nowDateTime() : null
          };
          let spawned = null;
          if (done && !wasDone) {
            spawned = spawnRecurInstance(tasks[idx]);
            if (spawned) tasks.push(spawned);
          }
          writeWithBackup(tasks);
          return respond(200, { ok: true, task: tasks[idx], spawned });
        }
        if (segments.length > 1) return next();
        if (method === "GET") {
          if (idx === -1) return respond(404, { error: `\u4EFB\u52A1\u4E0D\u5B58\u5728: ${id}` });
          return respond(200, { task: tasks[idx] });
        }
        if (method === "PATCH") {
          if (idx === -1) return respond(404, { error: `\u4EFB\u52A1\u4E0D\u5B58\u5728: ${id}` });
          const body = JSON.parse(await readBody(req));
          const cur = tasks[idx];
          const next2 = { ...cur };
          if (body.title !== void 0) {
            if (typeof body.title !== "string" || !body.title.trim()) {
              return respond(400, { error: "title \u4E0D\u80FD\u4E3A\u7A7A" });
            }
            next2.title = body.title.trim();
          }
          if (body.description !== void 0) {
            next2.description = typeof body.description === "string" ? body.description : "";
          }
          if (body.subtasks !== void 0) next2.subtasks = sanitizeSubtasks(body.subtasks);
          if (body.date !== void 0) {
            if (body.date !== null && !validateDate(body.date)) {
              return respond(400, { error: "date \u683C\u5F0F\u5E94\u4E3A YYYY-MM-DD \u6216 null" });
            }
            next2.date = validateDate(body.date);
          }
          if (body.priority !== void 0) {
            if (!PRIORITIES2.includes(body.priority)) {
              return respond(400, { error: `priority \u53EF\u9009\u503C: ${PRIORITIES2.join("/")}` });
            }
            next2.priority = body.priority;
          }
          if (body.tags !== void 0) next2.tags = sanitizeTags(body.tags);
          if (body.recur !== void 0) {
            if (body.recur !== null && !RECURS.includes(body.recur)) {
              return respond(400, { error: `recur \u53EF\u9009\u503C: ${RECURS.join("/")} \u6216 null` });
            }
            next2.recur = validateRecur(body.recur);
          }
          if (body.images !== void 0) next2.images = sanitizeImages(body.images);
          if (body.done !== void 0) {
            next2.done = body.done === true;
            next2.completedAt = next2.done ? nowDateTime() : null;
          }
          tasks[idx] = next2;
          let spawned = null;
          if (body.done === true && !cur.done) {
            spawned = spawnRecurInstance(next2);
            if (spawned) tasks.push(spawned);
          }
          writeWithBackup(tasks);
          return respond(200, { ok: true, task: next2, spawned });
        }
        if (method === "DELETE") {
          if (idx === -1) return respond(404, { error: `\u4EFB\u52A1\u4E0D\u5B58\u5728: ${id}` });
          const [removed] = tasks.splice(idx, 1);
          writeWithBackup(tasks);
          return respond(200, { ok: true, removed });
        }
      }
      return next();
    })().catch((e) => {
      if (e instanceof SyntaxError) {
        respond(400, { error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON" });
      } else {
        respond(500, { error: String(e) });
      }
    });
  };
}
function createImagesApiHandler(dataFile) {
  const imagesDir = import_node_path2.default.join(import_node_path2.default.dirname(dataFile), "images");
  return function handler(req, res, next) {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const url = (req.url ?? "/").split("?")[0];
    const segments = url.split("/").filter(Boolean).map(decodeURIComponent);
    const respond = (status, body) => send(res, status, body);
    (async () => {
      const method = req.method ?? "GET";
      if (method === "GET" && segments.length === 1) {
        const name = segments[0];
        if (!/^[A-Za-z0-9_-]+\.(png|jpg|jpeg|gif|webp)$/i.test(name)) {
          return respond(400, { error: "\u975E\u6CD5\u6587\u4EF6\u540D" });
        }
        const filePath = import_node_path2.default.join(imagesDir, name);
        if (!import_node_fs2.default.existsSync(filePath)) {
          return respond(404, { error: "\u56FE\u7247\u4E0D\u5B58\u5728" });
        }
        const ext = import_node_path2.default.extname(name).toLowerCase();
        const mime = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp"
        };
        res.statusCode = 200;
        res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        import_node_fs2.default.createReadStream(filePath).pipe(res);
        return;
      }
      if (method === "POST" && segments.length === 0) {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return respond(400, { error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON" });
        }
        const b64 = typeof body.data === "string" ? body.data : "";
        if (!b64) return respond(400, { error: "data \u4E0D\u80FD\u4E3A\u7A7A\uFF08base64\uFF09" });
        const buf = Buffer.from(b64, "base64");
        if (buf.length > 5 * 1024 * 1024) return respond(400, { error: "\u56FE\u7247\u8D85\u8FC7 5MB \u9650\u5236" });
        const ext = typeof body.name === "string" ? import_node_path2.default.extname(body.name).toLowerCase() || ".png" : ".png";
        const allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
        const safeExt = allowed.includes(ext) ? ext : ".png";
        const filename = `${newId()}${safeExt}`;
        import_node_fs2.default.mkdirSync(imagesDir, { recursive: true });
        import_node_fs2.default.writeFileSync(import_node_path2.default.join(imagesDir, filename), buf);
        return respond(201, { ok: true, filename });
      }
      return next();
    })().catch((e) => {
      if (e instanceof SyntaxError) {
        respond(400, { error: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON" });
      } else {
        respond(500, { error: String(e) });
      }
    });
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createImagesApiHandler,
  createTasksApiHandler
});
