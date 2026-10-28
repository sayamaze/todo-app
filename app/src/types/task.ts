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
  /** 图片文件名列表（存于 data/images/ 目录），如 ["a1b2.png"] */
  images?: string[];
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "高",
  medium: "中",
  low: "低",
  none: "无",
};

export const PRIORITY_ORDER: Priority[] = ["high", "medium", "low", "none"];

export const RECUR_LABEL: Record<Recur, string> = {
  daily: "每天",
  weekly: "每周",
  weekday: "工作日",
};

/** 计算重复任务的下一次日期（基于原日期顺延，保证跨过已过去的周期） */
export function nextRecurDate(date: string | null, recur: Recur, today: string): string {
  const base = date ?? today;
  const d = new Date(base + "T00:00:00");
  const step = () => {
    if (recur === "daily") d.setDate(d.getDate() + 1);
    else if (recur === "weekly") d.setDate(d.getDate() + 7);
    else {
      // weekday：顺延到下一个工作日（周一至五）
      do {
        d.setDate(d.getDate() + 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
    }
  };
  step();
  // 若顺延结果仍不在未来（原日期已过期多个周期），继续顺推到今天之后
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  while (fmt(d) <= today) step();
  return fmt(d);
}
