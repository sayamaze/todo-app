import type { Task } from "@/types/task";

export interface TasksResponse {
  file: string;
  /** 数据文件修改时间（毫秒），用于轮询感知外部改动 */
  mtime: number;
  tasks: Task[];
}

export async function fetchTasks(): Promise<TasksResponse> {
  const res = await fetch("/api/tasks");
  if (!res.ok) throw new Error(`读取任务失败: ${res.status}`);
  return res.json();
}

/** 数据文件版本（修改时间），用于轻量轮询 */
export async function fetchVersion(): Promise<number> {
  const res = await fetch("/api/tasks/version");
  if (!res.ok) throw new Error(`读取版本失败: ${res.status}`);
  const body = (await res.json()) as { mtime: number };
  return body.mtime;
}

/** 保存成功后的文件版本 */
export interface SaveResult {
  ok: true;
  mtime: number;
}

/** 保存时检测到外部改动：携带服务端最新数据，由调用方决定是否合并重试 */
export interface SaveConflict {
  ok: false;
  conflict: true;
  mtime: number;
  tasks: Task[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function putOnce(tasks: Task[], baseMtime?: number): Promise<SaveResult | SaveConflict> {
  const res = await fetch("/api/tasks", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks, baseMtime: baseMtime ?? null }),
  });
  if (res.status === 409) {
    const body = (await res.json()) as { mtime?: number; tasks?: Task[] };
    return { ok: false, conflict: true, mtime: body.mtime ?? 0, tasks: body.tasks ?? [] };
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.error ? ` ${body.error}` : "";
    } catch {
      /* 忽略解析失败 */
    }
    throw new Error(`保存失败: HTTP ${res.status}${detail}`);
  }
  try {
    const body = (await res.json()) as { mtime?: number };
    return { ok: true, mtime: body.mtime ?? 0 };
  } catch {
    return { ok: true, mtime: 0 };
  }
}

/**
 * 保存任务到本地 Markdown 文件。
 * - 传入 baseMtime 启用乐观锁：文件被外部改动时返回 conflict（不抛错），由调用方合并后重试；
 * - 网络抖动时自动重试一次。
 */
export async function saveTasks(tasks: Task[], baseMtime?: number): Promise<SaveResult | SaveConflict> {
  try {
    return await putOnce(tasks, baseMtime);
  } catch (e) {
    await sleep(600);
    try {
      return await putOnce(tasks, baseMtime);
    } catch {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
}

export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).toLowerCase();
}

/** 上传图片（File → base64 → POST /api/images），返回服务端文件名 */
export async function uploadImage(file: File): Promise<string> {
  const b64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 去掉 data:image/xxx;base64, 前缀
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const res = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: b64, name: file.name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `上传失败: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { filename: string };
  return body.filename;
}

/** 图片访问 URL */
export function imageUrl(filename: string): string {
  return `/api/images/${filename}`;
}
