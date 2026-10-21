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
  // 할 일 목록 API에만 들어 있다. (진행 중인 실행이 없으면 null)
  active_execution?: ActiveExecution | null;
};

// 끝나지 않은 실행. 상태는 저장하지 않고 열린 구간이 있는지로 계산한 값이다.
export type ActiveExecution = {
  id: string;
  status: "running" | "paused";
  work_seconds: number; // 이 값을 받은 시점까지의 작업 시간(초)
};

// 화면에서 쓰는 모양: 값을 받은 시각(receivedAt)을 같이 들고 있어서,
// 진행 중이면 "받은 값 + 그 뒤 흐른 시간"으로 타이머를 보여 준다.
// (서버 시계와 내 컴퓨터 시계가 달라도 타이머가 튀지 않게 하려는 방식)
export type LiveExecution = ActiveExecution & { receivedAt: number };

export type TodoView = Todo & { live: LiveExecution | null };

// 실행 시작/일시정지/재개/종료 API가 돌려주는 값 중 화면이 쓰는 부분
export type ExecutionResult = {
  status: "running" | "paused" | "ended";
  changed: boolean;
  created: boolean;
  work_seconds: number;
  execution: { id: string };
};
