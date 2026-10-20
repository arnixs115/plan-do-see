// 화면에 보여 줄 한글 이름 모음

import type { Priority, TodoStatus } from "./types";

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

export const STATUS_LABEL: Record<TodoStatus, string> = {
  todo: "시작 전",
  in_progress: "진행 중",
  completed: "완료",
};

export const STATUSES: TodoStatus[] = ["todo", "in_progress", "completed"];
