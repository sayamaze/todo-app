// 重复周期相关的纯常量与展示文案，与 task-ui / Home / WidgetApp 共用。

import { RECUR_LABEL, type Recur } from "@/types/task";

/** 重复任务选项（含「不重复」） */
export const RECUR_OPTIONS: (Recur | "none")[] = ["none", "daily", "weekly", "weekday"];

export function recurLabel(r: Recur | "none" | null | undefined): string {
  return r && r !== "none" ? RECUR_LABEL[r] : "不重复";
}
