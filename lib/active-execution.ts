// 계획의 할 일 목록에 "지금 진행 중인(끝나지 않은) 실행"을 붙이기 위한 조회.
//  - 할 일 하나에 끝나지 않은 실행은 최대 1개다. (DB 부분 유니크 인덱스가 보장)
//  - 상태는 저장하지 않고 계산한다: 열린 구간이 있으면 running, 없으면 paused.
//  - work_seconds는 구간 길이의 합이다. (일시 정지 시간은 구간이 아니라서 빠진다)

import type { SupabaseClient } from "@supabase/supabase-js";

export type ActiveExecutionSummary = {
  id: string;
  status: "running" | "paused";
  work_seconds: number;
};

type DbError = { code?: string; message?: string };

type Row = {
  id: string;
  todo_id: string;
  execution_segments: { started_at: string; ended_at: string | null }[] | null;
};

export function summarizeActive(row: Row, nowMs: number): ActiveExecutionSummary {
  const segments = row.execution_segments ?? [];
  const running = segments.some((segment) => !segment.ended_at);

  const seconds = segments.reduce((sum, segment) => {
    const end = segment.ended_at ? Date.parse(segment.ended_at) : nowMs;
    return sum + (end - Date.parse(segment.started_at)) / 1000;
  }, 0);

  return {
    id: row.id,
    status: running ? "running" : "paused",
    work_seconds: Math.round(seconds),
  };
}

// 계획 하나에 속한 할 일들의 진행 중 실행을 { todo_id → 요약 } 로 돌려준다.
export async function fetchActiveExecutions(
  supabase: SupabaseClient,
  planId: string
): Promise<
  { ok: true; byTodo: Map<string, ActiveExecutionSummary> } | { ok: false; error: DbError }
> {
  // todos!inner: 할 일이 이 계획에 속하는 실행만 (끝나지 않은 것만이라 행 수가 작다)
  const { data, error } = await supabase
    .from("executions")
    .select("id, todo_id, execution_segments(started_at, ended_at), todos!inner(plan_id)")
    .is("ended_at", null)
    .eq("todos.plan_id", planId);

  if (error) {
    return { ok: false, error };
  }

  const nowMs = Date.now();
  const byTodo = new Map<string, ActiveExecutionSummary>();

  for (const row of (data ?? []) as unknown as Row[]) {
    byTodo.set(row.todo_id, summarizeActive(row, nowMs));
  }

  return { ok: true, byTodo };
}
