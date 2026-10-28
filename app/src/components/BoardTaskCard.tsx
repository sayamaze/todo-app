// 看板/四象限列内使用的紧凑任务卡片。
// 与完整 TaskRow 不同：只展示勾选框 + 标题（截断）+ 优先级点 + 日期 + 标签精简，
// 单行/两行以内，自带拖拽句柄，适配窄列布局，避免长正文换行撑高行高。

import { useState } from "react";
import { Check, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { RECUR_LABEL, type Task } from "@/types/task";
import { isOutgoingTask } from "@/lib/taskUtils";
import {
  dateLabel,
  PRIORITY_RING,
  todayStr,
} from "@/lib/dateUtils";
import { Repeat } from "lucide-react";

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
};

export interface BoardTaskCardProps {
  task: Task;
  onToggle: () => void;
  onEdit: () => void;
  /** 拖拽状态回调：由父级（看板/四象限视图）统一管理 */
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

export function BoardTaskCard({
  task,
  onToggle,
  onEdit,
  onDragStart,
  onDragEnd,
  isDragging,
}: BoardTaskCardProps) {
  const isOverdue = task.date !== null && task.date < todayStr() && !task.done;
  const isToday = task.date === todayStr();
  const outgoing = isOutgoingTask(task);
  const [completing, setCompleting] = useState(false);

  const handleCheck = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.done || completing) {
      if (!completing) onToggle();
      return;
    }
    setCompleting(true);
    setTimeout(() => {
      setCompleting(false);
      onToggle();
    }, 450);
  };

  return (
    <div
      onClick={onEdit}
      className={cn(
        "group flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5 transition-all hover:border-primary/30 hover:shadow-sm",
        task.done && "opacity-55",
        outgoing && !task.done && "border-l-[3px] border-l-violet-400",
        isDragging && "opacity-40",
        completing && "task-completing"
      )}
    >
      {/* 拖拽手柄：仅它是拖拽源（draggable 收敛到手柄本身）。
          select-none 防止拖拽经过时选中卡片文字；不要在 onMouseDown preventDefault。 */}
      <span
        data-drag-handle
        title="按住拖动调整归属"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", task.id);
          onDragStart(task.id);
        }}
        onDragEnd={() => onDragEnd()}
        className={cn(
          "shrink-0 cursor-grab select-none rounded p-0.5 -ml-0.5 text-muted-foreground/30 transition-colors",
          "hover:bg-muted hover:text-muted-foreground/70 active:cursor-grabbing"
        )}
      >
        <GripVertical className="size-3.5" />
      </span>

      {/* 勾选框 */}
      <button
        onClick={handleCheck}
        onMouseDown={(e) => e.stopPropagation()}
        title={task.done ? "标记为未完成" : "标记为完成"}
        className={cn(
          "flex size-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
          task.done ? "border-green-500 bg-green-500" : PRIORITY_RING[task.priority]
        )}
      >
        {task.done && <Check className="size-2.5 text-white" strokeWidth={4} />}
      </button>

      {/* 标题：最多两行，超出截断（看板列已加宽，配合两行基本能看全） */}
      <span
        className={cn(
          "min-w-0 flex-1 text-[13px] leading-snug line-clamp-2 break-words",
          task.done && "text-muted-foreground line-through"
        )}
        title={task.title}
      >
        {task.title}
      </span>

      {/* 右侧精简信息 */}
      {task.recur && (
        <span title={`${RECUR_LABEL[task.recur]}重复`}>
          <Repeat className="size-3 shrink-0 text-emerald-500" />
        </span>
      )}
      {task.priority !== "none" && (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])}
          title={`优先级`}
        />
      )}
      {task.date && (
        <span
          className={cn(
            "shrink-0 text-[10px]",
            isOverdue ? "font-medium text-red-500" : isToday ? "font-medium text-primary" : "text-muted-foreground"
          )}
        >
          {dateLabel(task.date)}
        </span>
      )}
    </div>
  );
}
