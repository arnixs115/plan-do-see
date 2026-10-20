// API가 돌려주는 plans 행의 모양 (db 테이블 plans와 같다)

export type Priority = "low" | "medium" | "high";

export type Plan = {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  start_date: string | null; // "YYYY-MM-DD"
  end_date: string | null;
  target_date: string | null;
  estimated_minutes: number;
  success_criteria: string;
  next_plan_note: string;
  created_at: string;
  updated_at: string;
};

export type TodoStatus = "todo" | "in_progress" | "completed";

export type Todo = {
  id: string;
  plan_id: string;
  title: string;
  description: string;
  due_date: string | null; // "YYYY-MM-DD"
  priority: Priority;
  tags: string[];
  estimated_minutes: number;
  status: TodoStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};
