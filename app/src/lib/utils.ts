import type { KeyboardEvent } from "react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 是否处于输入法（IME）组合状态。
 * 中文/日文输入法待选词时按 Enter 是「候选上屏」，不应触发应用内的回车快捷键。
 */
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.nativeEvent?.isComposing === true;
}

/** Cmd/Ctrl + Enter 快捷键（输入法组合期间忽略） */
export function cmdEnter(action: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isImeComposing(e)) {
      e.preventDefault();
      action();
    }
  };
}
