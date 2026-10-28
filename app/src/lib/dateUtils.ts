// 日期与文本展示的纯辅助函数，与 Home.tsx / TaskRow / WidgetApp 共用。

import { addDays, format, parseISO } from "date-fns";
import { PRIORITY_ORDER, type Priority } from "@/types/task";

export const DATE_FMT = "yyyy-MM-dd";
export const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function todayStr(): string {
  return format(new Date(), DATE_FMT);
}

export function tomorrowStr(): string {
  return format(addDays(new Date(), 1), DATE_FMT);
}

export function dateLabel(dateStr: string): string {
  const t = todayStr();
  const tomorrow = format(addDays(new Date(), 1), DATE_FMT);
  if (dateStr === t) return "今天";
  if (dateStr === tomorrow) return "明天";
  const d = parseISO(dateStr);
  return `${WEEKDAYS[d.getDay()]} ${format(d, "MM-dd")}`;
}

export function priorityWeight(p: Priority): number {
  return PRIORITY_ORDER.indexOf(p);
}

/** 当前时间 "YYYY-MM-DD HH:mm"，用于完成时间记录 */
export function nowDateTime(): string {
  return format(new Date(), "yyyy-MM-dd HH:mm");
}

/** 完成时间展示：今天 11:09 完成 / 8月10日 15:32 完成 / 8月10日 完成 */
export function completedLabel(completedAt: string): string {
  const [d, tm] = completedAt.split(" ");
  const datePart = d === todayStr() ? "今天" : format(parseISO(d), "M月d日");
  return tm ? `${datePart} ${tm} 完成` : `${datePart} 完成`;
}

export function sortInGroup(a: { priority: Priority; title: string }, b: { priority: Priority; title: string }): number {
  const w = priorityWeight(a.priority) - priorityWeight(b.priority);
  if (w !== 0) return w;
  return a.title.localeCompare(b.title, "zh-CN");
}

export const PRIORITY_TEXT: Record<Priority, string> = {
  high: "text-red-500",
  medium: "text-amber-500",
  low: "text-sky-500",
  none: "text-muted-foreground",
};

export const PRIORITY_RING: Record<Priority, string> = {
  high: "border-red-400 hover:bg-red-50",
  medium: "border-amber-400 hover:bg-amber-50",
  low: "border-sky-400 hover:bg-sky-50",
  none: "border-muted-foreground/40 hover:bg-muted",
};

export const PRIORITY_CHIP: Record<Priority, string> = {
  high: "bg-red-50 text-red-600",
  medium: "bg-amber-50 text-amber-600",
  low: "bg-sky-50 text-sky-600",
  none: "bg-muted text-muted-foreground",
};
