import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import {
  CalendarIcon,
  Check,
  ChevronDown,
  Code2,
  Copy,
  FileText,
  Flag,
  HelpCircle,
  ListChecks,
  ListTodo,
  Plus,
  RefreshCw,
  Repeat,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fetchTasks, fetchVersion, saveTasks, newId, uploadImage, imageUrl } from "@/lib/api";
import { Toaster, toast } from "sonner";
import {
  nextRecurDate,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  RECUR_LABEL,
  type Priority,
  type Recur,
  type SubTask,
  type Task,
} from "@/types/task";
import {
  DATE_FMT,
  WEEKDAYS,
  PRIORITY_TEXT,
  dateLabel,
  nowDateTime,
  sortInGroup,
  todayStr,
  tomorrowStr,
} from "@/lib/dateUtils";
import {
  hasUrl,
  parseTagsInput,
  enforceDailyExclusive,
  DAILY_WORK_TAG,
  tagChipClass,
  taskDirection,
} from "@/lib/taskUtils";
import {
  DatePicker,
  LinkifiedText,
  PriorityMenu,
  RecurMenu,
  SubTaskCheck,
} from "@/components/task-ui";
import { cmdEnter, isImeComposing } from "@/lib/utils";
import { RECUR_OPTIONS, recurLabel } from "@/lib/recur";
import { TaskRow } from "@/components/TaskRow";
import { BoardTaskCard } from "@/components/BoardTaskCard";

interface DayGroup {
  key: string;
  label: string;
  sub?: string;
  overdue?: boolean;
  /** 拖动任务落到该分组时写入的目标日期（null = 无日期；缺省 = 该分组不可作为放置目标） */
  dropDate?: string | null;
  tasks: Task[];
}

/** 生成完整 API 文档（Markdown），file 为当前实际存储路径 */
function buildApiDoc(file: string): string {
  return `# 日程待办 · 开放 API 文档

本地 REST API，随应用启动，无需鉴权，已开启 CORS（允许任意来源跨域调用），其他本地应用、脚本、Agent 均可直接调用。

- Base URL：\`http://localhost:7100/api/tasks\`（桌面 App 默认 7100，被占用时自动换端口，以实际为准）
- 数据格式：JSON，UTF-8
- 所有写操作实时持久化到明文文件：\`${file}\`（Agent 也可直接读写该文件）

## 任务对象 Task

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 唯一 ID，创建时自动生成 |
| title | string | 标题（必填） |
| description | string | 正文描述，可多行 |
| subtasks | object[] | 子待办列表，如 [{"title":"步骤一","done":false}] |
| date | string \\| null | 完成日期 YYYY-MM-DD，null 为无日期 |
| priority | string | high / medium / low / none |
| tags | string[] | 标签列表，如 ["工作", "AI"] |
| done | boolean | 是否完成 |
| completedAt | string \\| null | 完成时间 YYYY-MM-DD HH:mm |
| recur | string \\| null | 重复周期 daily / weekly / weekday，完成时自动生成下一次 |

## 查询接口

| 方法与路径 | 说明 |
|---|---|
| GET /api/tasks | 全部任务，返回 { file, mtime, tasks } |
| GET /api/tasks/version | 数据文件版本（mtime），轻量轮询用 |
| GET /api/tasks/today | 今日未完成清单；加 ?includeOverdue=1 可同时包含已过期 |
| GET /api/tasks/week | 最近 7 天未完成清单 |
| GET /api/tasks/completed | 已完成清单（按完成时间倒序） |
| GET /api/tasks/overdue | 已过期未完成清单 |
| GET /api/tasks/tag/:tag | 指定标签下的未完成清单，如 /api/tasks/tag/工作 |
| GET /api/tasks/tags | 所有标签及任务计数 |
| GET /api/tasks/stats/weekly | 已完成任务按 ISO 周分组统计（周一开始），返回 { weeks } |
| GET /api/tasks/:id | 单个任务详情 |

## 写入接口

### 创建任务 POST /api/tasks

curl -X POST http://localhost:7100/api/tasks \\
  -H "Content-Type: application/json" \\
  -d '{"title":"写周报","description":"整理本周数据","date":"2026-08-15","priority":"high","tags":["工作"]}'

返回 201 { ok, task }。除 title 外均可省略。

### 更新任务 PATCH /api/tasks/:id

只传需要修改的字段（title / description / subtasks / date / priority / tags / done / recur 均可）：

curl -X PATCH http://localhost:7100/api/tasks/<id> \\
  -H "Content-Type: application/json" \\
  -d '{"date":"2026-08-16","priority":"medium"}'

### 完成 / 取消完成（重复任务完成时自动生成下一次实例）

curl -X POST http://localhost:7100/api/tasks/<id>/complete
curl -X POST http://localhost:7100/api/tasks/<id>/uncomplete

### 删除任务

curl -X DELETE http://localhost:7100/api/tasks/<id>

### 全量替换 PUT /api/tasks（乐观锁）

body 为 { "tasks": Task[], "baseMtime": number|null }。传入读取时的 mtime 作为 baseMtime，若文件已被外部改动则返回 409 { error, mtime, tasks }（携带最新数据），不会写入；baseMtime 传 null 则跳过校验。

## 错误格式

所有错误返回 JSON：{ "error": "中文错误描述" }，HTTP 状态码：400 参数错误 / 404 任务不存在 / 409 版本冲突 / 500 服务器错误。

## 典型场景

# 其他应用查询今天要做什么
curl -s http://localhost:7100/api/tasks/today

# 查询已完成清单
curl -s http://localhost:7100/api/tasks/completed

# 写入一条明天的低优先级任务
curl -X POST http://localhost:7100/api/tasks -H "Content-Type: application/json" \\
  -d '{"title":"给妈妈打电话","date":"2026-08-15","priority":"low","tags":["生活"]}'
`;
}

/** 复制到剪贴板（带降级方案） */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** API 文档弹窗中的代码块 */
function ApiCode({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted/70 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
      {children}
    </pre>
  );
}

/** API 文档弹窗中的表格 */
function ApiTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b bg-muted/50">
            {head.map((h) => (
              <th key={h} className="px-2.5 py-1.5 font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-2.5 py-1.5 align-top">
                  {j === 0 ? <code className="text-primary">{c}</code> : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 图片放大查看遮罩：点击任意处（含图片）或 ESC 关闭，z-index 高于所有 Dialog。
    所有事件阻止冒泡/默认行为，避免穿透到底层 Radix Dialog 导致级联关闭。 */
function LightboxOverlay({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    // capture 阶段拦截，确保先于 Radix Dialog 的 ESC 监听
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex cursor-zoom-out items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <img
        src={src}
        alt=""
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
      />
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30"
      >
        <X className="size-5" />
      </button>
    </div>
  );
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [file, setFile] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** "today" | "week" | `tag:某标签` */
  const [view, setView] = useState<string>("today");
  const [showDone, setShowDone] = useState(false);

  // 新增表单
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [tagsText, setTagsText] = useState("");
  /** 手动选择的日期；undefined = 未手动选择，跟随视图默认值（渲染时实时计算，跨天不会过期） */
  const [dateOverride, setDateOverride] = useState<string | null | undefined>(undefined);
  const [priority, setPriority] = useState<Priority>("none");
  const [recur, setRecur] = useState<Recur | null>(null);

  // 创建表单的实际日期：未手动选择时跟随视图（明天视图→明天，其余→今天），每次渲染实时计算
  const formDate =
    dateOverride !== undefined
      ? dateOverride
      : view === "tomorrow"
        ? tomorrowStr()
        : todayStr();

  // 编辑弹窗
  const [editing, setEditing] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSubs, setEditSubs] = useState<SubTask[]>([]);
  const [editMode, setEditMode] = useState<"text" | "sub">("text");
  const [editTags, setEditTags] = useState("");
  const [editRecur, setEditRecur] = useState<Recur | null>(null);
  const [editPriority, setEditPriority] = useState<Priority>("none");
  const [editDate, setEditDate] = useState<string | null>(null);
  const [editImages, setEditImages] = useState<string[]>([]);
  const editFileRef = useRef<HTMLInputElement>(null);
  /** 图片放大查看：当前查看的图片文件名，null 为关闭 */
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  // 标签输入自动补全的候选选中索引（-1 = 未选中，回车走默认提交）
  const [createTagSel, setCreateTagSel] = useState(-1);
  const [editTagSel, setEditTagSel] = useState(-1);
  // 空输入时按 ↓/↑ 唤出的「全部标签」浏览态（输入文字后自动关闭）
  const [tagBrowse, setTagBrowse] = useState(false);

  // 批量选择（Shift+点击勾选框）
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 功能说明弹窗
  const [showHelp, setShowHelp] = useState(false);

  // API 文档弹窗
  const [showApi, setShowApi] = useState(false);

  const activeTag = view.startsWith("tag:") ? view.slice(4) : null;

  const tasksRef = useRef<Task[]>([]);
  const reconnectTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 数据文件版本（mtime），用于感知外部（如 Agent 工具）对 md 文件的修改 */
  const mtimeRef = useRef(0);

  /** 连接断开时每 4 秒自动重连，恢复后自动刷新数据并清除错误 */
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) return;
    reconnectTimer.current = setInterval(async () => {
      try {
        const res = await fetchTasks();
        tasksRef.current = res.tasks;
        setTasks(res.tasks);
        setFile(res.file);
        setError("");
        if (reconnectTimer.current) {
          clearInterval(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      } catch {
        /* 服务器尚未恢复，继续等待 */
      }
    }, 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      setError("");
      const res = await fetchTasks();
      tasksRef.current = res.tasks;
      setTasks(res.tasks);
      setFile(res.file);
      mtimeRef.current = res.mtime;
    } catch (e) {
      setError(String(e));
      scheduleReconnect();
    } finally {
      setLoading(false);
    }
  }, [scheduleReconnect]);

  useEffect(() => {
    load();
    return () => {
      if (reconnectTimer.current) clearInterval(reconnectTimer.current);
    };
  }, [load]);

  /** 外部改动监听：每 3 秒轮询文件版本（mtime），被 Agent 等外部工具修改后自动刷新列表 */
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const m = await fetchVersion();
        if (mtimeRef.current !== 0 && m !== mtimeRef.current) load();
      } catch {
        /* 服务器暂不可达时静默，由重连机制兜底 */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [load]);

  /** 切换视图时清除手动选择的日期，恢复跟随视图默认值 */
  useEffect(() => {
    setDateOverride(undefined);
  }, [view]);

  /** 跨天监听：App 常驻运行（关窗不退出），午夜后触发重渲染，让“今天/明天”等派生值自动换新 */
  const [dayTick, setDayTick] = useState(todayStr());
  void dayTick;
  useEffect(() => {
    const timer = setInterval(() => {
      const t = todayStr();
      setDayTick((prev) => (prev === t ? prev : t));
    }, 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  /** 多选状态下 ESC 取消选择（弹窗打开时不拦截，ESC 留给弹窗自身） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selected.size > 0 && !editing && !showHelp)
        setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, editing, showHelp]);

  const mutate = useCallback(
    (fn: (prev: Task[]) => Task[]) => {
      const next = fn(tasksRef.current);
      tasksRef.current = next;
      setTasks(next);
      saveTasks(next, mtimeRef.current)
        .then((r) => {
          if (r.ok) {
            // 记录本次写入的文件版本，避免轮询把自己的写入误判为外部改动
            if (r.mtime) mtimeRef.current = r.mtime;
            return;
          }
          // 冲突：文件被外部（Agent 工具等）改过。外部只增不删，
          // 把外部新增/变更但本地快照里没有的任务并入后基于最新版本重试一次
          const localIds = new Set(next.map((t) => t.id));
          const externalOnly = r.tasks.filter((t) => !localIds.has(t.id));
          if (externalOnly.length === 0) {
            // 无纯新增任务（外部只是改了已有任务），直接采纳本地结果重试
            mtimeRef.current = r.mtime;
            return saveTasks(next, r.mtime).then((r2) => {
              if (r2.ok && r2.mtime) mtimeRef.current = r2.mtime;
            });
          }
          const merged = [...next, ...externalOnly];
          tasksRef.current = merged;
          setTasks(merged);
          mtimeRef.current = r.mtime;
          toast.info(`检测到 ${externalOnly.length} 条新任务（来自外部工具），已自动合并`);
          return saveTasks(merged, r.mtime).then((r2) => {
            if (r2.ok && r2.mtime) mtimeRef.current = r2.mtime;
          });
        })
        .catch((e) => {
          setError(`${e instanceof Error ? e.message : String(e)}，正在自动重连…`);
          scheduleReconnect();
        });
    },
    [scheduleReconnect]
  );

  const addTask = () => {
    const t = title.trim();
    if (!t) return;
    mutate((prev) => [
      ...prev,
      {
        id: newId(),
        title: t,
        description: desc.trim(),
        subtasks: [],
        date: formDate,
        priority,
        // 上下文属性覆盖：当前处于标签筛选视图时，新任务自动归属该标签（与输入标签合并去重）
        tags: enforceDailyExclusive([
          ...new Set([...parseTagsInput(tagsText), ...(activeTag ? [activeTag] : [])]),
        ]),
        done: false,
        completedAt: null,
        recur,
      },
    ]);
    setTitle("");
    setDesc("");
    setTagsText("");
    setPriority("none");
    setRecur(null);
    setDateOverride(undefined);
  };

  const openEdit = (task: Task) => {
    const subs = (task.subtasks ?? []).map((s) => ({ ...s }));
    setEditing(task);
    setEditTitle(task.title);
    setEditDesc(task.description);
    setEditSubs(subs);
    setEditMode(subs.length > 0 ? "sub" : "text");
    setEditTags((task.tags ?? []).join(" "));
    setEditRecur(task.recur ?? null);
    setEditPriority(task.priority);
    setEditDate(task.date);
    setEditImages(task.images ?? []);
  };

  /** 正文 <-> 子待办 模式切换，内容自动互转 */
  const switchEditMode = (m: "text" | "sub") => {
    if (m === editMode) return;
    if (m === "sub") {
      setEditSubs(
        editDesc
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((t) => ({ title: t, done: false }))
      );
    } else {
      setEditDesc(
        editSubs
          .filter((s) => s.title.trim())
          .map((s) => s.title)
          .join("\n")
      );
    }
    setEditMode(m);
  };

  const saveEdit = () => {
    if (!editing || !editTitle.trim()) return;
    mutate((prev) =>
      prev.map((t) =>
        t.id === editing.id
          ? {
              ...t,
              title: editTitle.trim(),
              description: editMode === "text" ? editDesc.trim() : "",
              subtasks:
                editMode === "sub" ? editSubs.filter((s) => s.title.trim()) : [],
              tags: enforceDailyExclusive(parseTagsInput(editTags)),
              recur: editRecur,
              priority: editPriority,
              date: editDate,
              images: editImages.length > 0 ? editImages : undefined,
            }
          : t
      )
    );
    setEditing(null);
  };

  /** 上传图片并追加到 editImages */
  const handleAddImages = async (files: File[]) => {
    for (const f of files) {
      try {
        const filename = await uploadImage(f);
        setEditImages((prev) => [...prev, filename]);
      } catch (e) {
        toast.error(`图片上传失败：${e instanceof Error ? e.message : e}`);
      }
    }
  };

  /** 编辑弹窗内删除：直接删除并关闭弹窗 */
  const deleteEditingTask = () => {
    if (!editing) return;
    mutate((prev) => prev.filter((t) => t.id !== editing.id));
    toast.success("已删除任务");
    setEditing(null);
  };

  /** 所有未完成任务中出现过的标签（按使用频率排序） */
  const allTags = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of tasks) {
      if (t.done) continue;
      for (const tag of t.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }, [tasks]);

  /** 标签输入自动补全：基于输入串最后一个空格之后的「正在输入的词」过滤已有标签。
      词为空时不过滤（供方向键唤起全部标签）；返回 null 表示无候选（不渲染下拉）。 */
  const tagSuggest = (text: string): { list: string[]; token: string } | null => {
    const token = text.slice(text.lastIndexOf(" ") + 1).replace(/^#/, "").trim();
    const typed = text.split(/\s+/).filter(Boolean).map((w) => w.replace(/^#/, ""));
    const excluded = token ? typed.slice(0, -1) : typed;
    const list = allTags
      .filter((t) => (!token || (t.includes(token) && t !== token)) && !excluded.includes(t))
      .slice(0, 6);
    return list.length ? { list, token } : null;
  };

  /** 用候选标签替换输入串最后一个词（补全选中） */
  const applyTagSuggestion = (text: string, tag: string): string => {
    const head = text.slice(0, text.length - (text.slice(text.lastIndexOf(" ") + 1).length));
    return `${head}${tag} `;
  };

  /** 标签输入框键盘事件：↓↑ 选择候选，回车确认候选（无候选时走默认提交）。
      onSubmit 为无候选/未选择候选时的回车动作（创建/保存）。 */
  const tagInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    text: string,
    setText: (v: string) => void,
    sel: { idx: number; setIdx: (i: number) => void },
    onSubmit: () => void
  ) => {
    const sg = tagSuggest(text);
    // ESC：收起候选/浏览态（弹层类交互的标准退出键）
    if (e.key === "Escape") {
      if (sg || sel.idx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        sel.setIdx(-1);
        setTagBrowse(false);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!sg) return;
      e.preventDefault();
      // 空词唤出（输入为空/刚输完空格）时同步展开下拉；有词时下拉随输入自动出现
      if (!sg.token) setTagBrowse(true);
      const n = sg.list.length;
      const next = sel.idx < 0
        ? (e.key === "ArrowDown" ? 0 : n - 1)
        : (e.key === "ArrowDown" ? (sel.idx + 1) % n : (sel.idx - 1 + n) % n);
      sel.setIdx(next);
      return;
    }
    if (e.key === "Enter") {
      if (isImeComposing(e)) return;
      if (sg && sel.idx >= 0) {
        e.preventDefault();
        setText(applyTagSuggestion(text, sg.list[sel.idx]));
        sel.setIdx(-1);
        setTagBrowse(false);
        return;
      }
      onSubmit();
    }
  };

  /** 标签候选下拉（创建表单/编辑弹窗共用） */
  const TagSuggestDropdown = ({
    text,
    selIdx,
    onPick,
    className,
    forceOpen,
  }: {
    text: string;
    selIdx: number;
    onPick: (tag: string) => void;
    className?: string;
    /** 空输入时方向键唤出的浏览态：即使 token 为空也展示全部候选 */
    forceOpen?: boolean;
  }) => {
    const sg = tagSuggest(text);
    if (!sg || (!sg.token && !forceOpen)) return null;
    return (
      <div
        className={cn(
          "absolute left-0 top-full z-30 mt-1 min-w-[140px] overflow-hidden rounded-lg border bg-popover py-1 shadow-md",
          className
        )}
      >
        {sg.list.map((t, i) => (
          <button
            key={t}
            // onMouseDown 先于 input blur，保证点击候选能生效；preventDefault 保持输入框焦点
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(t);
            }}
            className={cn(
              "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors",
              i === selIdx ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
            )}
          >
            <Tag className="size-3 opacity-60" />
            {t}
          </button>
        ))}
      </div>
    );
  };

  const groups = useMemo<DayGroup[]>(() => {
    const t = todayStr();
    const active = tasks.filter((x) => !x.done);

    // 标签视图：只看该标签下的任务，按日期分组
    // 「日常工作」额外包含无标签任务（默认归集）
    if (activeTag) {
      const tagged = active.filter((x) =>
        activeTag === DAILY_WORK_TAG
          ? (x.tags ?? []).length === 0 || (x.tags ?? []).includes(DAILY_WORK_TAG)
          : (x.tags ?? []).includes(activeTag)
      );
      const result: DayGroup[] = [];
      const overdue = tagged
        .filter((x) => x.date !== null && x.date < t)
        .sort(sortInGroup);
      const dates = [
        ...new Set(tagged.filter((x) => x.date !== null && x.date >= t).map((x) => x.date!)),
      ].sort();
      for (const d of dates) {
        result.push({
          key: d,
          label: dateLabel(d),
          sub: d,
          tasks: tagged.filter((x) => x.date === d).sort(sortInGroup),
        });
      }
      const noDate = tagged.filter((x) => x.date === null).sort(sortInGroup);
      if (noDate.length)
        result.push({ key: "nodate", label: "无日期", dropDate: null, tasks: noDate });
      // 已过期排在活跃分组之后
      if (overdue.length)
        result.push({ key: "overdue", label: "已过期", overdue: true, tasks: overdue });
      return result;
    }

    const overdue = active.filter((x) => x.date !== null && x.date < t).sort(sortInGroup);
    const noDate = active.filter((x) => x.date === null).sort(sortInGroup);
    const byDate = (d: string) => active.filter((x) => x.date === d).sort(sortInGroup);

    const result: DayGroup[] = [];

    // 排序：今天与未来 -> 无日期 -> 已过期（已完成始终在最后单独折叠展示）
    if (view === "today") {
      result.push({ key: t, label: "今天", sub: t, dropDate: t, tasks: byDate(t) });
    } else if (view === "tomorrow") {
      const tm = tomorrowStr();
      result.push({ key: tm, label: "明天", sub: tm, dropDate: tm, tasks: byDate(tm) });
    } else if (view === "all") {
      // 全部：显示所有今天及未来有日期的任务（不受 7 天限制）
      const dates = [
        ...new Set(active.filter((x) => x.date !== null && x.date >= t).map((x) => x.date!)),
      ].sort();
      for (const d of dates) {
        result.push({ key: d, label: dateLabel(d), sub: d, dropDate: d, tasks: byDate(d) });
      }
      if (result.length === 0 && noDate.length === 0 && overdue.length === 0)
        result.push({ key: t, label: "今天", sub: t, dropDate: t, tasks: [] });
    } else {
      // 最近7天：隐藏没有任务的日期（今天始终显示）
      for (let i = 0; i < 7; i++) {
        const d = format(addDays(new Date(), i), DATE_FMT);
        const dayTasks = byDate(d);
        if (dayTasks.length === 0 && d !== t) continue;
        result.push({ key: d, label: dateLabel(d), sub: d, dropDate: d, tasks: dayTasks });
      }
    }
    if (noDate.length)
      result.push({ key: "nodate", label: "无日期", dropDate: null, tasks: noDate });
    if (overdue.length)
      result.push({ key: "overdue", label: "已过期", overdue: true, tasks: overdue });
    return result;
  }, [tasks, view, activeTag]);

  const doneTasks = useMemo(() => {
    const done = tasks.filter((x) => x.done);
    const filtered = activeTag
      ? done.filter((x) =>
          activeTag === DAILY_WORK_TAG
            ? (x.tags ?? []).length === 0 || (x.tags ?? []).includes(DAILY_WORK_TAG)
            : (x.tags ?? []).includes(activeTag)
        )
      : done;
    return filtered.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  }, [tasks, activeTag]);

  /** 已完成任务按 ISO 周（周一起）分组，供归档视图与周统计使用 */
  interface DoneWeek {
    key: string;
    weekStart: string;
    weekEnd: string;
    isThisWeek: boolean;
    tasks: Task[];
  }
  const doneByWeek = useMemo<DoneWeek[]>(() => {
    const weeks = new Map<string, DoneWeek>();
    const t = todayStr();
    for (const task of doneTasks) {
      const dstr = (task.completedAt ?? "").slice(0, 10);
      if (!dstr) continue;
      const d = parseISO(dstr);
      const day = d.getDay() === 0 ? 7 : d.getDay();
      const start = addDays(d, -(day - 1));
      const end = addDays(start, 6);
      const ws = format(start, DATE_FMT);
      const we = format(end, DATE_FMT);
      if (!weeks.has(ws)) {
        weeks.set(ws, { key: ws, weekStart: ws, weekEnd: we, isThisWeek: t >= ws && t <= we, tasks: [] });
      }
      weeks.get(ws)!.tasks.push(task);
    }
    return [...weeks.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }, [doneTasks]);

  /** 周标签：本周 / 上周 / M月d日–M月d日 */
  function weekLabel(w: DoneWeek): string {
    const t = todayStr();
    if (w.isThisWeek) return "本周";
    const lastWeekStart = format(addDays(parseISO(t), -7 - (parseISO(t).getDay() === 0 ? 7 : parseISO(t).getDay()) + 1), DATE_FMT);
    if (w.weekStart === lastWeekStart) return "上周";
    return `${format(parseISO(w.weekStart), "M月d日")} – ${format(parseISO(w.weekEnd), "M月d日")}`;
  }

  const activeCount = tasks.filter((x) => !x.done).length;
  const todayCount = tasks.filter((x) => !x.done && x.date === todayStr()).length;
  const now = new Date();
  /** 四象限视图使用更宽的版面，避免 2×2 网格内文字挤压换行 */
  const isQuadrant = view === "quadrant" && !activeTag;
  /** 项目看板视图：四列按项目标签分列，同样使用宽版面 */
  const isBoard = view === "board" && !activeTag;
  /** 日期分组列表（今天/明天/最近7天/全部，含标签筛选视图）：宽版面 + 左右双列（左=今天及将来，右=已过期） */
  const isDateList = !isQuadrant && !isBoard;

  /** 拖动改日期：落到具体日期分组 / 无日期分组（已过期分组只读，不可作为放置目标）。
      返回是否有变化（无变化时调用方需兜底清理拖拽态）。 */
  const moveTaskToDate = useCallback(
    (taskId: string, d: string | null): boolean => {
      const cur = tasks.find((x) => x.id === taskId);
      if (!cur || cur.date === d) return false;
      mutate((prev) => prev.map((x) => (x.id === taskId ? { ...x, date: d } : x)));
      toast.success(`已调整至 ${d === null ? "无日期" : dateLabel(d)}`);
      return true;
    },
    [mutate, tasks]
  );

  /** 项目看板列定义：key 即归属标签名；「日常工作」为兜底列（无其他项目标签的任务） */
  const BOARD_COLUMNS = useMemo(
    () => [
      { key: "AI成本", label: "AI成本", color: "text-violet-600", bg: "bg-violet-50/60 border-violet-100" },
      { key: "X500U", label: "X500U", color: "text-sky-600", bg: "bg-sky-50/60 border-sky-100" },
      { key: "X600", label: "X600", color: "text-emerald-600", bg: "bg-emerald-50/60 border-emerald-100" },
      { key: "日常工作", label: "日常工作", color: "text-muted-foreground", bg: "bg-muted/40" },
    ],
    []
  );
  const boardProjectTags = useMemo(() => BOARD_COLUMNS.slice(0, 3).map((c) => c.key), [BOARD_COLUMNS]);

  /** 项目看板：按标签分列。任务可属于多列（多项目标签时归第一个匹配列），无项目标签归「日常工作」 */
  const boardColumns = useMemo(() => {
    const active = tasks.filter((x) => !x.done);
    const colOf = (x: Task): string => {
      const tags = x.tags ?? [];
      for (const tag of boardProjectTags) if (tags.includes(tag)) return tag;
      return "日常工作";
    };
    return BOARD_COLUMNS.map((c) => ({
      ...c,
      tasks: active.filter((x) => colOf(x) === c.key).sort(sortInGroup),
    }));
  }, [tasks, BOARD_COLUMNS, boardProjectTags]);

  /** 拖动改项目归属：移除其他项目标签，打上目标列标签（日常工作 = 移除所有项目标签） */
  const moveTaskToBoard = useCallback(
    (taskId: string, colKey: string) => {
      mutate((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          const rest = (t.tags ?? []).filter((tag) => !boardProjectTags.includes(tag) && tag !== "日常工作");
          const tags = colKey === "日常工作" ? rest : [...rest, colKey];
          return { ...t, tags };
        })
      );
      toast.success(colKey === "日常工作" ? "已移至 日常工作" : `已移至 ${colKey}`);
    },
    [mutate, boardProjectTags]
  );

  /** 拖动改象限归属：按目标象限设置优先级（重要度）与日期（紧急度） */
  const moveTaskToQuadrant = useCallback(
    (taskId: string, qKey: string) => {
      const t = todayStr();
      const tomorrow = tomorrowStr();
      // q1 重要且紧急 / q2 重要不紧急 / q3 紧急不重要 / q4 不重要不紧急
      const patch: Record<string, { priority: Priority; date: string | null }> = {
        q1: { priority: "high", date: t },
        q2: { priority: "high", date: tomorrow },
        q3: { priority: "none", date: t },
        q4: { priority: "none", date: null },
      };
      const p = patch[qKey];
      if (!p) return;
      mutate((prev) =>
        prev.map((x) => (x.id === taskId ? { ...x, priority: p.priority, date: p.date } : x))
      );
      const label = { q1: "重要且紧急", q2: "重要不紧急", q3: "紧急不重要", q4: "不重要不紧急" }[qKey];
      toast.success(`已移至「${label}」`);
    },
    [mutate]
  );

  /** 四象限：重要度 = 优先级（高/中 = 重要），紧急度 = 目标日期 ≤ 今天（含已过期） */
  const quadrants = useMemo(() => {
    const t = todayStr();
    const active = tasks.filter((x) => !x.done);
    const important = (x: Task) => x.priority === "high" || x.priority === "medium";
    const urgent = (x: Task) => x.date !== null && x.date <= t;
    const pick = (imp: boolean, urg: boolean) =>
      active.filter((x) => important(x) === imp && urgent(x) === urg).sort(sortInGroup);
    return [
      { key: "q1", label: "重要且紧急", hint: "立即去做", color: "text-red-500", bg: "bg-red-50/60 border-red-100", tasks: pick(true, true) },
      { key: "q2", label: "重要不紧急", hint: "计划去做", color: "text-sky-600", bg: "bg-sky-50/60 border-sky-100", tasks: pick(true, false) },
      { key: "q3", label: "紧急不重要", hint: "尽快处理", color: "text-amber-600", bg: "bg-amber-50/60 border-amber-100", tasks: pick(false, true) },
      { key: "q4", label: "不重要不紧急", hint: "可以缓一缓", color: "text-muted-foreground", bg: "bg-muted/40", tasks: pick(false, false) },
    ];
  }, [tasks]);

  // ---------- 批量操作 ----------
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const batchSetDate = (d: string | null) => {
    const n = selected.size;
    mutate((prev) => prev.map((t) => (selected.has(t.id) ? { ...t, date: d } : t)));
    setSelected(new Set());
    toast.success(`已将 ${n} 项任务调整至 ${d === null ? "无日期" : dateLabel(d)}`);
  };

  const batchComplete = () => {
    const n = selected.size;
    const ts = nowDateTime();
    mutate((prev) =>
      prev.map((t) =>
        selected.has(t.id) ? { ...t, done: true, completedAt: ts } : t
      )
    );
    setSelected(new Set());
    toast.success(`已完成 ${n} 项任务`);
  };

  const batchSetPriority = (p: Priority) => {
    const n = selected.size;
    mutate((prev) => prev.map((t) => (selected.has(t.id) ? { ...t, priority: p } : t)));
    setSelected(new Set());
    toast.success(`已将 ${n} 项任务设为${PRIORITY_LABEL[p]}优先级`);
  };

  const batchDelete = () => {
    const n = selected.size;
    mutate((prev) => prev.filter((t) => !selected.has(t.id)));
    setSelected(new Set());
    toast.success(`已删除 ${n} 项任务`);
  };

  // ---------- 拖拽（看板/四象限列间拖动） ----------
  const draggedIdRef = useRef<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  /** 看板/四象限列内的紧凑卡片：自带拖拽，点击进编辑，勾选完成 */
  const DraggableTaskRow = ({ task }: { task: Task }) => (
    <BoardTaskCard
      task={task}
      isDragging={dragTaskId === task.id}
      onToggle={() => rowProps(task).onToggle()}
      onEdit={() => openEdit(task)}
      onDragStart={(id) => {
        draggedIdRef.current = id; // 同步写入，drop 时立即可读（不依赖 state 时序）
        // state 更新延迟到下一帧：避免 dragstart 期间重渲染改变被拖拽的源 DOM，
        // 否则 Chromium 会因 drag 源元素变化而立即中止 drag 会话（dragover/drop 全部丢失）。
        requestAnimationFrame(() => setDragTaskId(id));
      }}
      onDragEnd={() => {
        draggedIdRef.current = null;
        setDragTaskId(null);
        setDragOverCol(null);
      }}
    />
  );

  /** 列容器拖拽目标属性：进入高亮、松手落列 */
  const dropProps = <T,>(colKey: string, onDropTask: (taskId: string, colKey: T) => boolean | void, colValue?: T) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverCol !== colKey) setDragOverCol(colKey);
    },
    onDragLeave: (e: React.DragEvent) => {
      // 仅在真正离开该容器时清除高亮（落入子元素不算离开，避免高亮闪烁/抖动）
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation(); // 防止分组内 drop 冒泡到列容器，重复执行移动
      // 优先取 dataTransfer（标准路径），兜底取 ref（React19 懒 DataTransfer / 快速拖拽时更稳）
      const id = e.dataTransfer.getData("text/plain") || draggedIdRef.current || dragTaskId;
      setDragOverCol(null);
      setDragTaskId(null);
      draggedIdRef.current = null;
      if (id) onDropTask(id, (colValue !== undefined ? colValue : colKey) as T);
    },
  });

  const rowProps = (task: Task) => ({
    task,
    onToggle: () =>
      mutate((prev) => {
        const target = prev.find((t) => t.id === task.id);
        if (!target) return prev;
        const nowDone = !target.done;
        const updated = prev.map((t) =>
          t.id === task.id
            ? { ...t, done: nowDone, completedAt: nowDone ? nowDateTime() : null }
            : t
        );
        // 重复任务：从未完成变为完成时生成下一次实例
        if (nowDone && target.recur) {
          updated.push({
            ...target,
            id: newId(),
            date: nextRecurDate(target.date, target.recur, todayStr()),
            done: false,
            completedAt: null,
            subtasks: (target.subtasks ?? []).map((s) => ({ ...s, done: false })),
          });
          toast.success(`已完成，下次${RECUR_LABEL[target.recur]}：${dateLabel(nextRecurDate(target.date, target.recur, todayStr()))}`);
        }
        return updated;
      }),
    onSetDate: (d: string | null) => {
      mutate((prev) => prev.map((t) => (t.id === task.id ? { ...t, date: d } : t)));
      toast.success(d === null ? "已设为无日期" : `已调整至 ${dateLabel(d)}`);
    },
    onSetPriority: (p: Priority) =>
      mutate((prev) => prev.map((t) => (t.id === task.id ? { ...t, priority: p } : t))),
    onSetRecur: (r: Recur | null) => {
      mutate((prev) => prev.map((t) => (t.id === task.id ? { ...t, recur: r } : t)));
      toast.success(r ? `已设为${RECUR_LABEL[r]}重复` : "已取消重复");
    },
    onToggleSubtask: (index: number) =>
      mutate((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                subtasks: (t.subtasks ?? []).map((s, i) =>
                  i === index ? { ...s, done: !s.done } : s
                ),
              }
            : t
        )
      ),
    onDelete: () => mutate((prev) => prev.filter((t) => t.id !== task.id)),
    onEdit: () => openEdit(task),
    onTagClick: (tag: string) => setView(`tag:${tag}`),
    selected: selected.has(task.id),
    onToggleSelect: () => toggleSelect(task.id),
  });

  return (
    <div className="min-h-screen bg-[#f5f6f8]">
      {/* 无边框窗口拖动条：覆盖顶部红绿灯区域，不遮挡任何交互内容 */}
      <div className="app-drag fixed inset-x-0 top-0 z-50 h-10" />
      <Toaster position="top-center" richColors closeButton />
      <div
        className={cn(
          "mx-auto px-5 py-10 transition-[max-width] duration-300",
          isBoard ? "max-w-[1440px]" : isQuadrant || isDateList ? "max-w-[1280px]" : "max-w-[640px]"
        )}
      >
        {/* 头部（整体可作为窗口拖动区域） */}
        <header className="app-drag mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <ListTodo className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">日程待办</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {format(now, "M月d日")} {WEEKDAYS[now.getDay()]} · 今天 {todayCount} 项 · 共 {activeCount} 项未完成
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="app-no-drag rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => setShowApi(true)}
              title="API 接口文档"
            >
              <Code2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="app-no-drag rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => setShowHelp(true)}
              title="功能说明"
            >
              <HelpCircle className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="app-no-drag rounded-full text-muted-foreground hover:text-foreground"
              onClick={load}
              title="从本地文件重新加载"
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </div>
        </header>

        {/* 视图切换 + 标签筛选 */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border bg-card p-1 shadow-sm">
            {(
              [
                ["today", "今天"],
                ["tomorrow", "明天"],
                ["week", "最近7天"],
                ["all", "全部"],
                ["quadrant", "四象限"],
                ["board", "项目"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-full px-5 py-1.5 text-sm font-medium transition-all",
                  view === v
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {(allTags.length > 0 || tasks.some((x) => !x.done && (x.tags ?? []).length === 0)) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* 「日常工作」始终在最前：无标签任务的默认归集入口 */}
              {!allTags.includes(DAILY_WORK_TAG) && tasks.some((x) => !x.done && (x.tags ?? []).length === 0) && (
                <button
                  onClick={() => setView(activeTag === DAILY_WORK_TAG ? "today" : `tag:${DAILY_WORK_TAG}`)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-all",
                    activeTag === DAILY_WORK_TAG
                      ? cn("border-transparent", tagChipClass(DAILY_WORK_TAG, true))
                      : cn("border-transparent bg-card", tagChipClass(DAILY_WORK_TAG))
                  )}
                >
                  <Tag className="size-3" />
                  {DAILY_WORK_TAG}
                </button>
              )}
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setView(activeTag === tag ? "today" : `tag:${tag}`)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-all",
                    activeTag === tag
                      ? cn("border-transparent", tagChipClass(tag, true))
                      : cn("border-transparent bg-card", tagChipClass(tag))
                  )}
                >
                  <Tag className="size-3" />
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* 新增任务 */}
        <div className="mb-8 rounded-2xl border bg-card p-4 shadow-sm transition-shadow focus-within:border-primary/40 focus-within:shadow">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isImeComposing(e) && addTask()}
            placeholder="添加任务，回车快速创建"
            className="border-0 px-1 text-base shadow-none focus-visible:ring-0"
          />
          <Textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={cmdEnter(addTask)}
            placeholder="正文描述（可选，⌘+回车 完成添加）"
            rows={2}
            className="mt-1 resize-none border-0 px-1 text-[15px] shadow-none focus-visible:ring-0"
          />
          <div className="relative mt-1 flex items-center gap-1.5 px-1">
            <Tag className="size-3.5 shrink-0 text-muted-foreground/70" />
            <input
              value={tagsText}
              onChange={(e) => {
                setTagsText(e.target.value);
                setCreateTagSel(-1);
                setTagBrowse(false);
              }}
              onKeyDown={(e) =>
                tagInputKeyDown(e, tagsText, setTagsText, { idx: createTagSel, setIdx: setCreateTagSel }, addTask)
              }
              onBlur={() => {
                setCreateTagSel(-1);
                setTagBrowse(false);
              }}
              placeholder="标签，空格分隔（可选，输入可补全已有标签）"
              className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            <TagSuggestDropdown
              text={tagsText}
              selIdx={createTagSel}
              forceOpen={tagBrowse}
              onPick={(t) => {
                setTagsText(applyTagSuggestion(tagsText, t));
                setCreateTagSel(-1);
                setTagBrowse(false);
              }}
            />
          </div>
          <div className="mt-2 flex items-center gap-2 border-t pt-3">
            <DatePicker date={formDate} onChange={setDateOverride} align="start">
              <button className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-muted/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <CalendarIcon className="size-3.5" />
                {formDate ? dateLabel(formDate) : "无日期"}
              </button>
            </DatePicker>
            <PriorityMenu priority={priority} onChange={setPriority}>
              <button className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-muted/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Flag className={cn("size-3.5", PRIORITY_TEXT[priority])} />
                {PRIORITY_LABEL[priority]}优先级
                <ChevronDown className="size-3 opacity-60" />
              </button>
            </PriorityMenu>
            <RecurMenu recur={recur} onChange={setRecur}>
              <button className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-muted/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Repeat className={cn("size-3.5", recur ? "text-emerald-500" : "text-muted-foreground")} />
                {recurLabel(recur)}
                <ChevronDown className="size-3 opacity-60" />
              </button>
            </RecurMenu>
            <div className="flex-1" />
            <Button
              size="sm"
              className="h-8 gap-1 rounded-lg px-4"
              onClick={addTask}
              disabled={!title.trim()}
            >
              <Plus className="size-4" />
              添加
            </Button>
          </div>
        </div>

        {/* 分组列表 */}
        {activeTag && groups.length === 0 && (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            标签「#{activeTag}」下暂无未完成任务
          </p>
        )}

        {/* 项目看板视图：四列按标签分列，列间拖动改归属 */}
        {isBoard ? (
          <div className="grid grid-cols-4 items-start gap-3">
            {boardColumns.map((c) => (
              <section
                key={c.key}
                {...dropProps(c.key, moveTaskToBoard)}
                className={cn(
                  "rounded-xl border p-3 transition-all",
                  c.bg,
                  dragOverCol === c.key && "ring-2 ring-primary/40 border-primary/40 scale-[1.01]"
                )}
              >
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className={cn("text-[13px] font-semibold", c.color)}>{c.label}</h2>
                  <span className="rounded-full bg-white/70 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                    {c.tasks.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {c.tasks.length === 0 && (
                    <p className="rounded-lg border border-dashed border-current/20 px-3 py-4 text-center text-[11px] text-muted-foreground/70">
                      暂无任务
                    </p>
                  )}
                  {c.tasks.map((task) => (
                    <DraggableTaskRow key={task.id} task={task} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : /* 四象限视图：2×2，支持拖动改归属象限 */
        isQuadrant ? (
          <div className="grid grid-cols-2 items-start gap-4">
            {quadrants.map((q) => (
              <section
                key={q.key}
                {...dropProps(q.key, moveTaskToQuadrant)}
                className={cn(
                  "rounded-xl border p-3 transition-all",
                  q.bg,
                  dragOverCol === q.key && "ring-2 ring-primary/40 border-primary/40 scale-[1.01]"
                )}
              >
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className={cn("text-[13px] font-semibold", q.color)}>
                    {q.label}
                    <span className="ml-1.5 text-[11px] font-normal opacity-70">{q.hint}</span>
                  </h2>
                  <span className="rounded-full bg-white/70 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                    {q.tasks.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {q.tasks.length === 0 && (
                    <p className="rounded-lg border border-dashed border-current/20 px-3 py-4 text-center text-[11px] text-muted-foreground/70">
                      暂无任务
                    </p>
                  )}
                  {q.tasks.map((task) => (
                    <DraggableTaskRow key={task.id} task={task} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className={cn(isDateList && "grid grid-cols-2 items-start gap-x-8")}>
            {(isDateList
              ? [groups.filter((g) => !g.overdue), groups.filter((g) => g.overdue)]
              : [groups]
            ).map((colGroups, colIdx) => (
              <div
                key={colIdx}
                className="space-y-6"
                // 左列（今天及将来）整体也作为拖放目标：落到分组之间的空白处时默认归到「今天」。
                // 右列（已过期）是只读结果列，不接受拖入。
                {...(isDateList && colIdx === 0 ? dropProps("col-future", moveTaskToDate, todayStr()) : {})}
              >
                {/* 右列（已过期）无任务时占位提示，保持两列语义完整 */}
                {colGroups.length === 0 && isDateList && colIdx === 1 && (
                  <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
                    没有已过期任务 ✨
                  </p>
                )}
                {colGroups.map((g) => (
              <section
                key={g.key}
                {...(g.dropDate !== undefined
                  ? dropProps<string | null>(g.key, moveTaskToDate, g.dropDate)
                  : {})}
                className={cn(
                  "rounded-xl transition-all",
                  dragOverCol === g.key && "ring-2 ring-primary/40 bg-primary/5"
                )}
              >
                <div className="mb-2 flex items-baseline gap-2 px-1">
                  <h2
                    className={cn(
                      "text-[13px] font-semibold tracking-wide",
                      g.overdue ? "text-red-500" : "text-foreground/80"
                    )}
                  >
                    {g.label}
                  </h2>
                  {g.sub && g.label !== g.sub && (
                    <span className="text-[11px] text-muted-foreground">{g.sub}</span>
                  )}
                  {g.tasks.length > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[10px] font-medium",
                        g.overdue ? "bg-red-50 text-red-500" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {g.tasks.length}
                    </span>
                  )}
                  {/* 方向细分计数：创=我创建的，发=我安排的，收=我收到的 */}
                  {g.tasks.length > 0 &&
                    (() => {
                      const out = g.tasks.filter((x) => taskDirection(x) === "outgoing").length;
                      const inc = g.tasks.filter((x) => taskDirection(x) === "incoming").length;
                      const mine = g.tasks.length - out - inc;
                      return (
                        <span className="inline-flex items-center gap-1">
                          {mine > 0 && (
                            <span
                              title="我创建的"
                              className="rounded-full bg-green-50 px-1.5 py-px text-[10px] font-medium text-green-600"
                            >
                              创{mine}
                            </span>
                          )}
                          {out > 0 && (
                            <span
                              title="我安排的"
                              className="rounded-full bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-600"
                            >
                              发{out}
                            </span>
                          )}
                          {inc > 0 && (
                            <span
                              title="我收到的"
                              className="rounded-full bg-blue-50 px-1.5 py-px text-[10px] font-medium text-blue-600"
                            >
                              收{inc}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                </div>
                <div className="space-y-2">
                  {g.tasks.length === 0 && (g.key === todayStr() || g.key === tomorrowStr()) && (
                    <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
                      {g.label}没有任务，享受当下 ✨
                    </p>
                  )}
                  {g.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      {...rowProps(task)}
                      draggable
                      isDragging={dragTaskId === task.id}
                      onTaskDragStart={(id) => {
                        draggedIdRef.current = id;
                        requestAnimationFrame(() => setDragTaskId(id));
                      }}
                      onTaskDragEnd={() => {
                        draggedIdRef.current = null;
                        setDragTaskId(null);
                        setDragOverCol(null);
                      }}
                    />
                  ))}
                </div>
              </section>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 已完成（按周分组归档） */}
        {doneTasks.length > 0 && (
          <div className="mt-10">
            <button
              onClick={() => setShowDone(!showDone)}
              className="mb-2 flex items-center gap-1.5 px-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown
                className={cn("size-4 transition-transform", !showDone && "-rotate-90")}
              />
              已完成
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium">
                {doneTasks.length}
              </span>
              {/* 周统计摘要：本周完成数 */}
              {doneByWeek.length > 0 && doneByWeek[0].isThisWeek && (
                <span className="ml-1 rounded-full bg-green-50 px-1.5 py-px text-[10px] font-medium text-green-600">
                  本周 {doneByWeek[0].tasks.length} 项
                </span>
              )}
            </button>
            {showDone && (
              <div className="space-y-5">
                {doneByWeek.map((w) => (
                  <section key={w.key}>
                    <div className="mb-1.5 flex items-baseline gap-2 px-1">
                      <h3
                        className={cn(
                          "text-[12px] font-semibold",
                          w.isThisWeek ? "text-green-600" : "text-muted-foreground"
                        )}
                      >
                        {weekLabel(w)}
                      </h3>
                      <span className="text-[10px] text-muted-foreground/70">
                        {format(parseISO(w.weekStart), "MM-dd")} ~ {format(parseISO(w.weekEnd), "MM-dd")}
                      </span>
                      <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                        {w.tasks.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {w.tasks.map((task) => (
                        <TaskRow key={task.id} {...rowProps(task)} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 存储说明 */}
        {file && (
          <p className="mt-12 break-all text-center text-[11px] leading-relaxed text-muted-foreground/70">
            明文存储于本地：{file}
          </p>
        )}
      </div>

      {/* 批量操作面板（参考滴答清单）：Shift+点击卡片选中后，贴着待办卡片右侧浮现；ESC 取消选择 */}
      {selected.size > 0 && (
        <div
          className="fixed top-1/2 z-40 w-[232px] -translate-y-1/2 rounded-2xl border bg-card p-4 shadow-xl"
          style={{
            // 贴内容列右侧（内容列宽 640 / 四象限与看板 1080），窗口过窄时收回屏内
            left: `min(calc(50% + ${isQuadrant || isBoard ? 536 : 316}px), calc(100vw - 248px))`,
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">已选择 {selected.size} 项</span>
            <button
              className="text-xs font-medium text-primary transition-opacity hover:opacity-70"
              onClick={() => setSelected(new Set())}
            >
              取消(ESC)
            </button>
          </div>

          {/* 设置日期 */}
          <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-xs font-medium text-muted-foreground">
            <CalendarIcon className="size-3.5" />
            设置日期
          </div>
          <div className="mb-1.5 grid grid-cols-2 gap-1.5">
            {(
              [
                ["今天", todayStr()],
                ["明天", tomorrowStr()],
                ["下周", format(addDays(new Date(), 7), DATE_FMT)],
                ["无日期", null],
              ] as const
            ).map(([label, d]) => (
              <button
                key={label}
                onClick={() => batchSetDate(d)}
                className="rounded-lg bg-muted/60 px-2 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
              >
                {label}
              </button>
            ))}
          </div>
          {/* 手动选择日期 */}
          <DatePicker date={null} onChange={(d) => d && batchSetDate(d)} align="start">
            <button className="mb-3 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
              <CalendarIcon className="size-3.5" />
              选择日期…
            </button>
          </DatePicker>

          {/* 优先级 */}
          <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-xs font-medium text-muted-foreground">
            <Flag className="size-3.5" />
            优先级
          </div>
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            {PRIORITY_ORDER.map((p) => (
              <button
                key={p}
                onClick={() => batchSetPriority(p)}
                className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
              >
                <Flag className={cn("size-3.5", PRIORITY_TEXT[p])} />
                {PRIORITY_LABEL[p]}优先级
              </button>
            ))}
          </div>

          {/* 完成 / 删除 */}
          <div className="grid grid-cols-2 gap-1.5 border-t pt-3">
            <button
              onClick={batchComplete}
              className="flex items-center justify-center gap-1 rounded-lg bg-green-50 px-2 py-2 text-xs font-medium text-green-600 transition-colors hover:bg-green-100"
            >
              <Check className="size-3.5" />
              完成
            </button>
            <button
              onClick={batchDelete}
              className="flex items-center justify-center gap-1 rounded-lg bg-red-50 px-2 py-2 text-xs font-medium text-red-500 transition-colors hover:bg-red-100"
            >
              <Trash2 className="size-3.5" />
              删除
            </button>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      <Dialog open={!!editing} onOpenChange={(o) => {
        // lightbox 打开时不允许 Dialog 关闭（lightbox 优先消费事件）
        if (!o && lightboxImg) return;
        if (!o) setEditing(null);
      }}>
        {/* 宽版编辑弹窗：默认 sm:max-w-lg(512px) → 614px（+20%），长正文阅读更宽 */}
        <DialogContent
          className="sm:max-w-[614px]"
          onInteractOutside={(e) => {
            // lightbox 打开时阻止 Dialog 的 outside 交互关闭
            if (lightboxImg) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (lightboxImg) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>编辑任务</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="任务标题"
              className="text-base"
              onKeyDown={(e) => e.key === "Enter" && !isImeComposing(e) && saveEdit()}
            />

            {/* 内容模式切换：正文 / 子待办 */}
            <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
              <button
                onClick={() => switchEditMode("text")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-3 py-1.5 font-medium transition-colors",
                  editMode === "text" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FileText className="size-3.5" />
                正文
              </button>
              <button
                onClick={() => switchEditMode("sub")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-3 py-1.5 font-medium transition-colors",
                  editMode === "sub" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ListChecks className="size-3.5" />
                子待办
              </button>
            </div>

            {editMode === "text" ? (
              <>
                <Textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  onKeyDown={cmdEnter(saveEdit)}
                  placeholder="正文描述（可选，⌘+回车 保存）；可直接粘贴/拖拽图片到此处"
                  rows={10}
                  className="max-h-[45vh] resize-y text-base"
                  onPaste={(e) => {
                    const items = [...(e.clipboardData?.items ?? [])];
                    const files = items
                      .filter((item) => item.type.startsWith("image/"))
                      .map((item) => item.getAsFile())
                      .filter(Boolean) as File[];
                    if (files.length) {
                      e.preventDefault();
                      void handleAddImages(files);
                    }
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
                    if (files.length) void handleAddImages(files);
                  }}
                />
                {/* 链接预览：识别到 URL 时实时展示保存后的渲染效果 */}
                {hasUrl(editDesc) && (
                  <div className="rounded-lg border bg-muted/30 px-3 py-2">
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                      链接预览
                    </div>
                    <LinkifiedText
                      text={editDesc}
                      className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground"
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-1.5 rounded-lg border p-2">
                {editSubs.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <SubTaskCheck
                      done={s.done}
                      onToggle={() =>
                        setEditSubs((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, done: !x.done } : x))
                        )
                      }
                    />
                    <input
                      value={s.title}
                      onChange={(e) =>
                        setEditSubs((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && isImeComposing(e)) return; // 输入法待选上屏，不响应
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          saveEdit();
                        } else if (e.key === "Enter") {
                          e.preventDefault();
                          setEditSubs((prev) => [...prev, { title: "", done: false }]);
                        }
                      }}
                      placeholder="子待办内容"
                      className="w-full border-b border-transparent bg-transparent py-1 text-base outline-none focus:border-border"
                    />
                    <button
                      onClick={() => setEditSubs((prev) => prev.filter((_, j) => j !== i))}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                      title="删除子待办"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setEditSubs((prev) => [...prev, { title: "", done: false }])}
                  className="flex items-center gap-1 px-0.5 pt-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                  添加子待办
                </button>
              </div>
            )}

            {/* 图片预览：已添加的图片缩略图，点击放大，悬浮可删除 */}
            {editImages.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-1">
                {editImages.map((img, i) => (
                  <div key={img} className="group relative">
                    <img
                      src={imageUrl(img)}
                      alt=""
                      className="size-16 cursor-zoom-in rounded-md border object-cover transition-opacity hover:opacity-80"
                      onClick={() => setLightboxImg(img)}
                    />
                    <button
                      onClick={() => setEditImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-white opacity-0 transition-opacity group-hover:opacity-100"
                      title="移除图片"
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => editFileRef.current?.click()}
                  className="flex size-16 items-center justify-center rounded-md border border-dashed border-muted-foreground/25 text-muted-foreground/40 transition-colors hover:border-muted-foreground/50 hover:text-muted-foreground/70"
                  title="添加图片"
                >
                  <Plus className="size-5" />
                </button>
              </div>
            )}
            {/* 无图片时显示一个低调的添加入口 */}
            {editImages.length === 0 && (
              <button
                onClick={() => editFileRef.current?.click()}
                className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
              >
                <Plus className="size-3" />
                添加图片（也可直接粘贴/拖拽到正文）
              </button>
            )}
            <input
              ref={editFileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                if (files.length) void handleAddImages(files);
                e.target.value = "";
              }}
            />

            <div className="relative flex items-center gap-1.5 px-1">
              <Tag className="size-3.5 shrink-0 text-muted-foreground/70" />
              <input
                value={editTags}
                onChange={(e) => {
                  setEditTags(e.target.value);
                  setEditTagSel(-1);
                  setTagBrowse(false);
                }}
                onKeyDown={(e) =>
                  tagInputKeyDown(e, editTags, setEditTags, { idx: editTagSel, setIdx: setEditTagSel }, saveEdit)
                }
                onBlur={() => {
                  setEditTagSel(-1);
                  setTagBrowse(false);
                }}
                placeholder="标签，空格分隔（可选，输入可补全已有标签）"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              />
              <TagSuggestDropdown
                text={editTags}
                selIdx={editTagSel}
                forceOpen={tagBrowse}
                onPick={(t) => {
                  setEditTags(applyTagSuggestion(editTags, t));
                  setEditTagSel(-1);
                  setTagBrowse(false);
                }}
              />
            </div>

            {/* 重复周期 */}
            <div className="flex items-center gap-2 px-1">
              <Repeat className="size-3.5 shrink-0 text-muted-foreground/70" />
              <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                {RECUR_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setEditRecur(r === "none" ? null : r)}
                    className={cn(
                      "rounded-md px-3 py-1.5 font-medium transition-colors",
                      (editRecur ?? "none") === r
                        ? "bg-card shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {recurLabel(r)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="items-center">
            {/* 左侧：删除 */}
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={deleteEditingTask}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
            {/* 中部：日期 / 优先级快捷调整（与创建表单同一套菜单） */}
            <DatePicker date={editDate} onChange={setEditDate} align="end">
              <button className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <CalendarIcon className="size-3.5" />
                {editDate ? dateLabel(editDate) : "无日期"}
              </button>
            </DatePicker>
            <PriorityMenu priority={editPriority} onChange={setEditPriority}>
              <button className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/70 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Flag className={cn("size-3.5", PRIORITY_TEXT[editPriority])} />
                {PRIORITY_LABEL[editPriority]}优先级
                <ChevronDown className="size-3 opacity-60" />
              </button>
            </PriorityMenu>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={saveEdit} disabled={!editTitle.trim()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 图片放大查看：点击缩略图弹出，点击任意处（含图片本身）或 ESC 关闭 */}
      {lightboxImg && <LightboxOverlay src={imageUrl(lightboxImg)} onClose={() => setLightboxImg(null)} />}

      {/* API 接口文档弹窗 */}
      <Dialog open={showApi} onOpenChange={setShowApi}>
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code2 className="size-4" />
              开放 API 接口文档
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1 text-sm leading-relaxed">
            <p className="text-muted-foreground">
              本地 REST API，随应用启动，无需鉴权，已开启 CORS，其他本地应用、脚本、Agent 均可直接调用。
              Base URL：<code className="rounded bg-muted px-1.5 py-0.5 text-xs text-primary">http://localhost:7100/api/tasks</code>
              <br />
              写操作实时持久化到明文文件：<code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs text-primary">{file}</code>
            </p>

            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-foreground/80">任务对象 Task</h3>
              <ApiTable
                head={["字段", "类型", "说明"]}
                rows={[
                  ["id", "string", "唯一 ID，创建时自动生成"],
                  ["title", "string", "标题（必填）"],
                  ["description", "string", "正文描述，可多行"],
                  ["subtasks", "object[]", '子待办列表，如 [{"title":"步骤一","done":false}]'],
                  ["date", "string | null", "完成日期 YYYY-MM-DD，null 为无日期"],
                  ["priority", "string", "high / medium / low / none"],
                  ["tags", "string[]", '标签列表，如 ["工作", "AI"]'],
                  ["done", "boolean", "是否完成"],
                  ["completedAt", "string | null", "完成时间 YYYY-MM-DD HH:mm"],
                ]}
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-foreground/80">查询接口</h3>
              <ApiTable
                head={["方法与路径", "说明"]}
                rows={[
                  ["GET /api/tasks", "全部任务，返回 { file, mtime, tasks }"],
                  ["GET /api/tasks/version", "数据文件版本（mtime），轻量轮询用"],
                  ["GET /api/tasks/today", "今日未完成；加 ?includeOverdue=1 包含已过期"],
                  ["GET /api/tasks/week", "最近 7 天未完成清单"],
                  ["GET /api/tasks/completed", "已完成清单（按完成时间倒序）"],
                  ["GET /api/tasks/overdue", "已过期未完成清单"],
                  ["GET /api/tasks/tag/:tag", "指定标签下的未完成清单"],
                  ["GET /api/tasks/tags", "所有标签及任务计数"],
                  ["GET /api/tasks/stats/weekly", "已完成按周统计（周一起），返回 { weeks }"],
                  ["GET /api/tasks/:id", "单个任务详情"],
                ]}
              />
            </section>

            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-foreground/80">写入接口</h3>
              <ApiCode>{`# 创建任务 POST /api/tasks（除 title 外均可省略）
curl -X POST http://localhost:7100/api/tasks \\
  -H "Content-Type: application/json" \\
  -d '{"title":"写周报","date":"2026-08-15","priority":"high","tags":["工作"]}'

# 更新任务 PATCH /api/tasks/:id（只传需修改的字段）
curl -X PATCH http://localhost:7100/api/tasks/<id> \\
  -H "Content-Type: application/json" \\
  -d '{"date":"2026-08-16","priority":"medium"}'

# 完成 / 取消完成
curl -X POST http://localhost:7100/api/tasks/<id>/complete
curl -X POST http://localhost:7100/api/tasks/<id>/uncomplete

# 删除任务
curl -X DELETE http://localhost:7100/api/tasks/<id>

# 全量替换 PUT /api/tasks，body 为 { "tasks": Task[], "baseMtime": 读取时的mtime }
# 传入 baseMtime 启用乐观锁：文件被外部改动时返回 409 并携带最新数据，不写入`}</ApiCode>
            </section>

            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-foreground/80">典型场景</h3>
              <ApiCode>{`# 其他应用查询今天要做什么
curl -s http://localhost:7100/api/tasks/today

# 查询已完成清单
curl -s http://localhost:7100/api/tasks/completed`}</ApiCode>
            </section>

            <p className="text-xs text-muted-foreground">
              错误格式：{`{ "error": "中文错误描述" }`}，状态码 400 参数错误 / 404 任务不存在 / 500 服务器错误。
            </p>
          </div>
          <DialogFooter>
            <Button
              className="gap-1.5"
              onClick={async () => {
                await copyText(buildApiDoc(file));
                toast.success("API 文档已全部复制");
              }}
            >
              <Copy className="size-4" />
              全部复制
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 功能说明弹窗 */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>功能说明</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm leading-relaxed">
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold text-foreground/80">视图</h3>
              <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                <li>今天 / 明天 / 最近7天 / 全部：按日期分组查看待办，「明天」视图下创建任务默认日期为明天</li>
                <li>四象限：按重要度（优先级）× 紧急度（日期 ≤ 今天）分类，可拖动卡片到其他象限自动调整优先级与日期</li>
                <li>项目：按标签分列看板（AI成本 / X500U / X600 / 日常工作），可拖动卡片到其他列调整归属标签</li>
                <li>点击任务上的 #标签，可切换查看该类别下的清单</li>
              </ul>
            </section>
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold text-foreground/80">创建与编辑</h3>
              <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                <li>输入标题后回车快速创建；正文中 ⌘+回车 完成添加</li>
                <li>单击卡片进入编辑，内容支持「正文 / 子待办」两种模式</li>
                <li>悬浮卡片右侧可设置优先级、调整日期（今天/明天/下周/指定日期）、设置重复周期</li>
                <li>重复任务（每天/每周/工作日）完成时自动生成下一次实例</li>
                <li>勾选圆形框标记完成，已完成任务记录完成时间，按周分组归档并统计每周完成数</li>
              </ul>
            </section>
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold text-foreground/80">批量操作</h3>
              <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                <li>Shift + 单击待办卡片：选中/取消选中，右侧出现批量面板</li>
                <li>批量面板支持：设置日期（含手动选择日期）、设置优先级、完成、删除</li>
                <li>ESC：取消所有选择</li>
              </ul>
            </section>
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold text-foreground/80">数据与其他</h3>
              <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                <li>全部数据以 Markdown 明文存储在本地，可被其他工具直接读写</li>
                <li>每日自动备份（保留 30 份）；提供本地 HTTP 接口供外部应用查询/写入</li>
                <li>菜单栏托盘图标可开启桌面小组件，快速查看/完成今日待办</li>
                <li>每日 9:00 对当天到期的高/中优先级任务发系统通知（托盘菜单可开关）</li>
              </ul>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
