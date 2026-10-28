// 单个任务卡片：标题、结构化正文（多消息块 + 进展）、子待办、元信息（优先级/日期/标签/重复）、悬浮操作。
// 从 Home.tsx 抽取，供主页面分组列表、四象限、已完成归档共用。

import { useState } from "react";
import { CalendarIcon, Check, Flag, GripVertical, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PRIORITY_LABEL,
  RECUR_LABEL,
  type Priority,
  type Recur,
  type Task,
} from "@/types/task";
import {
  hasStructuredDesc,
  isOutgoingTask,
  parseDescription,
  tagChipClass,
} from "@/lib/taskUtils";
import {
  completedLabel,
  dateLabel,
  PRIORITY_CHIP,
  PRIORITY_RING,
  PRIORITY_TEXT,
  todayStr,
} from "@/lib/dateUtils";
import {
  AvatarBadge,
  DatePicker,
  LinkifiedText,
  PriorityMenu,
  RecurMenu,
  SubTaskCheck,
} from "@/components/task-ui";

export interface TaskRowProps {
  task: Task;
  onToggle: () => void;
  onSetDate: (d: string | null) => void;
  onSetPriority: (p: Priority) => void;
  onSetRecur: (r: Recur | null) => void;
  onToggleSubtask: (index: number) => void;
  onDelete: () => void;
  onEdit: () => void;
  onTagClick: (tag: string) => void;
  selected: boolean;
  onToggleSelect: () => void;
  /** 拖拽相关（可选）：日期分组列表中按手柄拖动调整日期归属 */
  draggable?: boolean;
  isDragging?: boolean;
  onTaskDragStart?: (taskId: string) => void;
  onTaskDragEnd?: () => void;
}

export function TaskRow({
  task,
  onToggle,
  onSetDate,
  onSetPriority,
  onSetRecur,
  onToggleSubtask,
  onDelete,
  onEdit,
  onTagClick,
  selected,
  onToggleSelect,
  draggable,
  isDragging,
  onTaskDragStart,
  onTaskDragEnd,
}: TaskRowProps) {
  const isToday = task.date === todayStr();
  const isOverdue = task.date !== null && task.date < todayStr() && !task.done;
  const tags = task.tags ?? [];
  const subtasks = task.subtasks ?? [];
  const subDone = subtasks.filter((s) => s.done).length;
  const outgoing = isOutgoingTask(task);
  const parsed = parseDescription(task.description ?? "");
  const structured = hasStructuredDesc(parsed);
  const restText = parsed.rest.join("\n").trim();

  // 完成动效：右滑淡出 + 高度收起，动画结束后才真正提交完成状态
  const [completing, setCompleting] = useState(false);

  const handleCheckClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
      onToggleSelect();
      return;
    }
    if (task.done || completing) {
      if (!completing) onToggle(); // 取消完成不播放动画
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
      onClick={(e) => {
        // Shift+单击卡片 = 选中进入批量操作（按钮区域除外，避免与操作冲突）
        if (!e.shiftKey) return;
        if ((e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        onToggleSelect();
      }}
      onMouseDown={(e) => {
        // 避免 Shift+点击时选中卡片文字
        if (e.shiftKey && !(e.target as HTMLElement).closest("button, input, textarea"))
          e.preventDefault();
      }}
      className={cn(
        "group flex items-start gap-3 rounded-xl border bg-card px-4 py-3 transition-all hover:border-primary/25 hover:shadow-sm",
        task.done && "opacity-55",
        selected && "border-primary/50 bg-primary/5 ring-1 ring-primary/30",
        // 我提出的任务：左侧紫色标识条
        outgoing && !task.done && "border-l-[3px] border-l-violet-400",
        isDragging && "opacity-40",
        completing && "task-completing"
      )}
    >
      {/* 拖拽手柄：仅它是拖拽源（draggable 收敛到手柄本身，不从卡片发起拖拽，
          避免卡片/手柄在拖拽命中链中状态不一致导致 dragstart 被拦）。
          select-none 防止拖拽经过时选中文字；不要在 onMouseDown preventDefault。 */}
      {draggable && (
        <span
          data-drag-handle
          title="按住拖动调整日期"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", task.id);
            onTaskDragStart?.(task.id);
          }}
          onDragEnd={() => onTaskDragEnd?.()}
          className={cn(
            "-ml-1.5 mt-0.5 shrink-0 cursor-grab select-none self-center rounded p-0.5 text-muted-foreground/30 transition-colors",
            "hover:bg-muted hover:text-muted-foreground/70 active:cursor-grabbing"
          )}
        >
          <GripVertical className="size-4" />
        </span>
      )}
      {/* 自定义圆形勾选框，颜色随优先级；Shift+点击卡片任意位置可批量多选 */}
      <button
        onClick={handleCheckClick}
        title={task.done ? "标记为未完成（Shift+点击卡片多选）" : "标记为完成（Shift+点击卡片多选）"}
        className={cn(
          "mt-1 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
          selected
            ? "border-primary bg-primary"
            : task.done
              ? "border-green-500 bg-green-500"
              : PRIORITY_RING[task.priority]
        )}
      >
        {(task.done || selected) && <Check className="size-3 text-white" strokeWidth={3.5} />}
      </button>

      <div
        className="min-w-0 flex-1 cursor-pointer"
        onClick={(e) => {
          // Shift+点击时交给卡片的批量多选，不进入编辑
          if (e.shiftKey) return;
          onEdit();
        }}
      >
        <div
          className={cn(
            "text-base font-medium leading-snug",
            task.done && "text-muted-foreground line-through"
          )}
        >
          {task.title}
        </div>
        {/* 正文：识别到约定格式（来源/发起人/责任人/消息）时按消息块流式渲染，否则普通文本+链接识别 */}
        {task.description &&
          (structured ? (
            <div className="mt-1.5 space-y-1.5">
              {restText && (
                <LinkifiedText
                  text={restText}
                  className="line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground"
                />
              )}
              {parsed.blocks.map((b, bi) => (
                <div key={bi} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {b.initiator && <AvatarBadge name={b.initiator} prefix="来自 " tone="blue" />}
                    {b.isSelf && b.owner && <AvatarBadge name={b.owner} prefix="责任人 " tone="green" />}
                    {b.source && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {tags.includes("群消息") ? "👥" : tags.includes("单聊") ? "💬" : tags.includes("手动") ? "✏️" : "💬"}
                        {b.source}
                      </span>
                    )}
                  </div>
                  {b.message && (
                    <div className="rounded-r-md border-l-2 border-border bg-muted/50 px-2.5 py-1.5">
                      <div className="mb-0.5 text-[10px] font-medium text-muted-foreground/70">
                        💬 需求原文
                      </div>
                      <LinkifiedText
                        text={b.message}
                        className="line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground"
                      />
                    </div>
                  )}
                </div>
              ))}
              {parsed.progress.map((p, pi) => (
                <div
                  key={pi}
                  className="rounded-r-md border-l-2 border-green-300 bg-green-50/50 px-2.5 py-1.5"
                >
                  <div className="mb-0.5 text-[10px] font-medium text-green-600/80">📌 今日进展</div>
                  <LinkifiedText
                    text={p}
                    className="line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground"
                  />
                </div>
              ))}
            </div>
          ) : (
            <LinkifiedText
              text={task.description}
              className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground"
            />
          ))}

        {/* 子待办清单 */}
        {subtasks.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {subtasks.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <SubTaskCheck done={s.done} onToggle={() => onToggleSubtask(i)} />
                <span
                  className={cn(
                    "text-sm leading-snug",
                    s.done && "text-muted-foreground line-through"
                  )}
                >
                  {s.title}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 已完成：展示完成时间 */}
        {task.done && task.completedAt && (
          <div className="mt-1 text-xs text-muted-foreground">
            ✓ {completedLabel(task.completedAt)}
          </div>
        )}

        {(task.priority !== "none" || task.date || tags.length > 0 || subtasks.length > 0) &&
          !task.done && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {task.priority !== "none" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
                    PRIORITY_CHIP[task.priority]
                  )}
                >
                  <Flag className="size-2.5" />
                  {PRIORITY_LABEL[task.priority]}
                </span>
              )}
              {task.date && (
                <span
                  className={cn(
                    "text-[11px]",
                    isOverdue
                      ? "font-medium text-red-500"
                      : isToday
                        ? "font-medium text-primary"
                        : "text-muted-foreground"
                  )}
                >
                  {dateLabel(task.date)}
                </span>
              )}
              {task.recur && (
                <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-600">
                  <Repeat className="size-2.5" />
                  {RECUR_LABEL[task.recur]}
                </span>
              )}
              {subtasks.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  子待办 {subDone}/{subtasks.length}
                </span>
              )}
              {tags.map((tag) => (
                <button
                  key={tag}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagClick(tag);
                  }}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    tagChipClass(tag)
                  )}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
      </div>

      {/* 悬浮才显示的操作按钮：未悬浮时同时禁用指针事件，避免隐形按钮遮挡点击 */}
      <div className="pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <PriorityMenu priority={task.priority} onChange={onSetPriority}>
          <Button variant="ghost" size="icon" className="size-7" title="设置优先级">
            <Flag className={cn("size-4", PRIORITY_TEXT[task.priority])} />
          </Button>
        </PriorityMenu>
        <DatePicker date={task.date} onChange={onSetDate}>
          <Button variant="ghost" size="icon" className="size-7" title="调整日期">
            <CalendarIcon className="size-4 text-muted-foreground" />
          </Button>
        </DatePicker>
        <RecurMenu recur={task.recur} onChange={onSetRecur}>
          <Button variant="ghost" size="icon" className="size-7" title="重复周期">
            <Repeat className={cn("size-4", task.recur ? "text-emerald-500" : "text-muted-foreground")} />
          </Button>
        </RecurMenu>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          title="删除"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
