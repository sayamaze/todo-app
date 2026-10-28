// 通用 UI 小组件：头像徽章、子待办勾选框、链接化文本、快捷日期按钮、日期选择器、优先级菜单、重复周期菜单。
// 从 Home.tsx 抽取，供主页面与批量操作面板共用。

import { useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { Check, Flag, Repeat } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  type Priority,
  type Recur,
} from "@/types/task";
import { avatarColor, URL_RE } from "@/lib/taskUtils";
import { DATE_FMT, PRIORITY_TEXT, todayStr } from "@/lib/dateUtils";
import { RECUR_OPTIONS, recurLabel } from "@/lib/recur";

/** 人名头像徽章（名字首字 + 稳定配色圆点） */
export function AvatarBadge({
  name,
  prefix,
  tone,
}: {
  name: string;
  prefix?: string;
  tone: "blue" | "green" | "violet";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    violet: "bg-violet-50 text-violet-700",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-[10px] font-medium",
        tones[tone]
      )}
    >
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
        style={{ background: avatarColor(name) }}
      >
        {name.charAt(0) || "?"}
      </span>
      {prefix}
      {name}
    </span>
  );
}

/** 子待办小勾选框 */
export function SubTaskCheck({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex size-[15px] shrink-0 items-center justify-center rounded border-[1.5px] transition-colors",
        done ? "border-green-500 bg-green-500" : "border-muted-foreground/40 hover:bg-muted"
      )}
    >
      {done && <Check className="size-2.5 text-white" strokeWidth={4} />}
    </button>
  );
}

/** 正文渲染：自动识别超链接，点击在新窗口/默认浏览器打开 */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <div className={className}>
      {parts.map((part, i) => {
        if (!/^(https?:\/\/|www\.)/.test(part)) return part;
        const href = part.startsWith("www.") ? `https://${part}` : part;
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer break-all text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
            title={href}
          >
            {part}
          </a>
        );
      })}
    </div>
  );
}

export function QuickDateButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full cursor-pointer select-none rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/5 text-primary"
          : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

export function DatePicker({
  date,
  onChange,
  align = "end",
  children,
}: {
  date: string | null;
  onChange: (d: string | null) => void;
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pick = (d: string | null) => {
    onChange(d);
    setOpen(false);
  };
  const t = todayStr();
  const tomorrow = format(addDays(new Date(), 1), DATE_FMT);
  const nextWeek = format(addDays(new Date(), 7), DATE_FMT);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* z-[70] 高于顶部窗口拖动条(z-50)，app-no-drag 确保在无边框窗口中始终可点 */}
      <PopoverContent align={align} className="app-no-drag z-[70] w-[320px] p-0">
        <div className="grid grid-cols-4 gap-1.5 p-3 pb-2">
          <QuickDateButton label="今天" active={date === t} onClick={() => pick(t)} />
          <QuickDateButton label="明天" active={date === tomorrow} onClick={() => pick(tomorrow)} />
          <QuickDateButton label="下周" active={date === nextWeek} onClick={() => pick(nextWeek)} />
          <QuickDateButton label="无日期" active={date === null} onClick={() => pick(null)} />
        </div>
        <div className="border-t px-1 py-1">
          <Calendar
            mode="single"
            className="w-full p-2 [--cell-size:2.5rem]"
            classNames={{
              root: "w-full",
              // 覆盖时必须保留默认布局类：relative 供月份切换箭头定位，flex 让日历撑满面板
              months: "relative flex w-full flex-col",
              month: "flex w-full flex-col gap-4",
            }}
            selected={date ? parseISO(date) : undefined}
            onSelect={(d) => d && pick(format(d, DATE_FMT))}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PriorityMenu({
  priority,
  onChange,
  children,
}: {
  priority: Priority;
  onChange: (p: Priority) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        {PRIORITY_ORDER.map((p) => (
          <DropdownMenuItem key={p} onClick={() => onChange(p)}>
            <Flag className={cn("size-4", PRIORITY_TEXT[p])} />
            {PRIORITY_LABEL[p]}优先级
            {p === priority && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 重复周期选择菜单 */
export function RecurMenu({
  recur,
  onChange,
  children,
}: {
  recur: Recur | null | undefined;
  onChange: (r: Recur | null) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        {RECUR_OPTIONS.map((r) => (
          <DropdownMenuItem key={r} onClick={() => onChange(r === "none" ? null : r)}>
            <Repeat
              className={cn("size-4", r === "none" ? "text-muted-foreground" : "text-emerald-500")}
            />
            {recurLabel(r)}
            {(recur ?? "none") === r && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
