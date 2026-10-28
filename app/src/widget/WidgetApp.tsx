import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Check, ListTodo, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchTasks, saveTasks } from "@/lib/api";
import type { Task } from "@/types/task";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
  none: "bg-muted-foreground/30",
};

/** 桌面悬浮小组件：今天 + 已过期的待办，紧凑展示，30 秒自动刷新 */
export default function WidgetApp() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [spinning, setSpinning] = useState(false);

  const load = useCallback(async (showSpin = false) => {
    try {
      if (showSpin) setSpinning(true);
      const res = await fetchTasks();
      setTasks(res.tasks);
    } catch {
      /* 服务器未就绪时下个周期再试 */
    } finally {
      if (showSpin) setSpinning(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const toggle = (task: Task) => {
    const next = tasks.map((t) =>
      t.id === task.id
        ? {
            ...t,
            done: !t.done,
            completedAt: !t.done ? format(new Date(), "yyyy-MM-dd HH:mm") : null,
          }
        : t
    );
    setTasks(next);
    saveTasks(next)
      .then((r) => {
        // 与外部改动冲突时以服务端最新数据为准重新加载
        if (!r.ok) load();
      })
      .catch(() => load());
  };

  const t = todayStr();
  const todayTasks = tasks.filter((x) => !x.done && x.date === t);
  const overdueTasks = tasks.filter((x) => !x.done && x.date !== null && x.date < t);
  const now = new Date();

  const row = (task: Task, overdue = false) => (
    <div key={task.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/5">
      <button
        onClick={() => toggle(task)}
        className="flex size-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-muted-foreground/40 transition-colors hover:bg-muted"
        title="标记为完成"
      />
      <span className="min-w-0 flex-1 truncate text-[13px] leading-snug">{task.title}</span>
      {task.priority !== "none" && (
        <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
      )}
      {overdue && (
        <span className="shrink-0 text-[10px] font-medium text-red-500">
          {format(parseISO(task.date!), "M月d日")}过期
        </span>
      )}
    </div>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-2xl border bg-card/95 shadow-xl">
      {/* 头部（拖动区域） */}
      <div className="app-drag flex shrink-0 items-center justify-between border-b bg-primary/5 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <ListTodo className="size-3.5 text-primary" />
          <span className="text-xs font-semibold">日程待办</span>
          <span className="text-[10px] text-muted-foreground">
            {format(now, "M月d日")} {WEEKDAYS[now.getDay()]}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
            今天 {todayTasks.length}
          </span>
          <button
            onClick={() => load(true)}
            className="app-no-drag text-muted-foreground transition-colors hover:text-foreground"
            title="刷新"
          >
            <RefreshCw className={cn("size-3", spinning && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {todayTasks.length === 0 && overdueTasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <Check className="size-5 text-green-500" />
            <p className="text-xs">今天没有待办，享受当下 ✨</p>
          </div>
        ) : (
          <>
            {overdueTasks.length > 0 && (
              <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold text-red-500">已过期</p>
            )}
            {overdueTasks.map((x) => row(x, true))}
            {todayTasks.length > 0 && (
              <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold text-muted-foreground">今天</p>
            )}
            {todayTasks.map((x) => row(x))}
          </>
        )}
      </div>
    </div>
  );
}
