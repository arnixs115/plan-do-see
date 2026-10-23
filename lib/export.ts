// 내보내기(Export): 계획·할 일·실행 데이터를 읽어서 CSV 행으로 만든다.
//
//  * DB를 바꾸지 않는 읽기 전용 코드다. 통계는 저장하지 않고 내보낼 때 계산한다.
//  * 삭제된 할 일도 deleted_at 열을 채운 채로 포함한다. (필요 없으면 시트에서 걸러내면 된다)
//  * 작업 시간은 실행 구간(execution_segments)의 합이다. 일시 정지 시간은 빠지고,
//    진행 중인 구간은 "지금"까지로 계산한다. (plan_summary와 같은 규칙)
//  * PostgREST는 한 번에 최대 1000행만 돌려주므로 페이지 단위로 끝까지 읽는다.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbErrorResponse, errorResponse } from "@/lib/api-utils";
import { toCsv, type CsvCell } from "@/lib/csv";

export type ExportType = "todos" | "executions";

export function parseExportType(
  request: Request
): { ok: true; type: ExportType } | { ok: false; response: NextResponse } {
  const value = new URL(request.url).searchParams.get("type") ?? "todos";

  if (value === "todos" || value === "executions") {
    return { ok: true, type: value };
  }

  return {
    ok: false,
    response: errorResponse("type은 todos 또는 executions 중 하나여야 합니다.", 400),
  };
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

type PlanRow = {
  id: string;
  title: string;
  description: string;
  priority: string;
  start_date: string | null;
  end_date: string | null;
  target_date: string | null;
  estimated_minutes: number;
  success_criteria: string;
  next_plan_note: string;
  created_at: string;
  updated_at: string;
};

type SegmentRow = { started_at: string; ended_at: string | null };

type ExecutionRow = {
  id: string;
  started_at: string | null;
  ended_at: string | null;
  actual_minutes: number | null;
  blocker_reason: string;
  execution_segments: SegmentRow[];
};

type TodoRow = {
  id: string;
  plan_id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string | null;
  tags: string[];
  estimated_minutes: number;
  deleted_at: string | null;
  created_at: string;
  executions: ExecutionRow[];
};

type DbError = { code?: string; message?: string };

const PAGE_SIZE = 500;
const MAX_PAGES = 200; // 안전장치: 최대 100,000행

async function fetchAllRows<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: DbError | null }>
): Promise<{ ok: true; rows: T[] } | { ok: false; error: DbError }> {
  const rows: T[] = [];

  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);

    if (error) {
      return { ok: false, error };
    }

    rows.push(...(data ?? []));

    if (!data || data.length < PAGE_SIZE) {
      break;
    }
  }

  return { ok: true, rows };
}

// 내보낼 데이터를 읽는다. planId가 있으면 그 계획만, 없으면 전체 계획.
// 계획이 없으면 { notFound: true }.
async function loadExportData(
  supabase: SupabaseClient,
  planId: string | null,
  ownerId: string | null
): Promise<
  | { ok: true; plans: PlanRow[]; todos: TodoRow[] }
  | { ok: false; notFound?: boolean; error?: DbError }
> {
  const plansResult = await fetchAllRows<PlanRow>((from, to) => {
    let query = supabase.from("plans").select("*");

    if (planId) {
      query = query.eq("id", planId);
    } else if (ownerId) {
      // 전체 내보내기: 내 계획과 예시 계획만 (ownerId는 Supabase Auth의 uuid)
      query = query.or(`user_id.eq.${ownerId},is_example.eq.true`);
    }

    return query.order("created_at", { ascending: true }).order("id").range(from, to);
  });

  if (!plansResult.ok) {
    return { ok: false, error: plansResult.error };
  }

  if (planId && plansResult.rows.length === 0) {
    return { ok: false, notFound: true };
  }

  // 할 일 + 실행 + 구간을 읽는다. (외래 키 관계로 중첩해서 가져옴)
  // 전체 내보내기에서는 위에서 읽은 계획(내 것 + 예시)에 속한 할 일만 읽는다.
  // 조건에 쓰는 계획 id가 많아질 때 주소가 너무 길어지지 않도록 50개씩 나눠 읽는다.
  const planIds = planId ? [planId] : plansResult.rows.map((plan) => plan.id);
  const todos: TodoRow[] = [];

  for (let i = 0; i < planIds.length; i += 50) {
    const chunk = planIds.slice(i, i + 50);

    const todosResult = await fetchAllRows<TodoRow>((from, to) =>
      supabase
        .from("todos")
        .select(
          "*, executions(id, started_at, ended_at, actual_minutes, blocker_reason, execution_segments(started_at, ended_at))"
        )
        .in("plan_id", chunk)
        .order("created_at", { ascending: true })
        .order("id")
        .range(from, to)
    );

    if (!todosResult.ok) {
      return { ok: false, error: todosResult.error };
    }

    todos.push(...todosResult.rows);
  }

  return { ok: true, plans: plansResult.rows, todos };
}

// ---------------------------------------------------------------------------
// 계산
// ---------------------------------------------------------------------------

// 실행 하나의 작업 시간(초, 소수 포함). 진행 중인 구간은 now까지.
function executionSeconds(execution: ExecutionRow, nowMs: number) {
  return (execution.execution_segments ?? []).reduce((sum, segment) => {
    const end = segment.ended_at ? Date.parse(segment.ended_at) : nowMs;
    return sum + (end - Date.parse(segment.started_at)) / 1000;
  }, 0);
}

// 초 → 분 (소수 첫째 자리까지 반올림). 예상 시간(estimated_minutes)과 같은 단위다.
function toMinutes(seconds: number) {
  return Math.round((seconds / 60) * 10) / 10;
}

function executionStatus(execution: ExecutionRow) {
  if (execution.ended_at) {
    return "ended";
  }

  const hasOpenSegment = (execution.execution_segments ?? []).some(
    (segment) => !segment.ended_at
  );

  return hasOpenSegment ? "running" : "paused";
}

// ---------------------------------------------------------------------------
// CSV 행 만들기
// ---------------------------------------------------------------------------

const PLAN_COLUMNS = [
  "plan_id",
  "plan_title",
  "plan_description",
  "plan_priority",
  "plan_start_date",
  "plan_end_date",
  "plan_target_date",
  "plan_estimated_minutes",
  "plan_success_criteria",
  "plan_next_plan_note",
  "plan_created_at",
  "plan_updated_at",
] as const;

function planCells(plan: PlanRow): CsvCell[] {
  return [
    plan.id,
    plan.title,
    plan.description,
    plan.priority,
    plan.start_date,
    plan.end_date,
    plan.target_date,
    plan.estimated_minutes,
    plan.success_criteria,
    plan.next_plan_note,
    plan.created_at,
    plan.updated_at,
  ];
}

const TODO_COLUMNS = [
  "todo_id",
  "todo_title",
  "todo_description",
  "todo_status",
  "todo_priority",
  "todo_due_date",
  "todo_tags",
  "todo_estimated_minutes",
  "todo_created_at",
  "todo_deleted_at",
] as const;

function todoCells(todo: TodoRow | null): CsvCell[] {
  if (!todo) {
    return TODO_COLUMNS.map(() => null);
  }

  return [
    todo.id,
    todo.title,
    todo.description,
    todo.status,
    todo.priority,
    todo.due_date,
    (todo.tags ?? []).join(";"),
    todo.estimated_minutes,
    todo.created_at,
    todo.deleted_at,
  ];
}

// 계획 → 그 계획의 할 일 순서로 묶는다. (계획은 만든 순서, 할 일은 만든 순서)
function groupTodosByPlan(plans: PlanRow[], todos: TodoRow[]) {
  const byPlan = new Map<string, TodoRow[]>();

  for (const todo of todos) {
    const list = byPlan.get(todo.plan_id);

    if (list) {
      list.push(todo);
    } else {
      byPlan.set(todo.plan_id, [todo]);
    }
  }

  return plans.map((plan) => ({ plan, todos: byPlan.get(plan.id) ?? [] }));
}

// type=todos: 할 일 한 개가 한 행. 할 일이 없는 계획도 한 행(할 일 열은 비움)으로 나온다.
function buildTodoRows(plans: PlanRow[], todos: TodoRow[], nowMs: number) {
  const columns = [
    ...PLAN_COLUMNS,
    ...TODO_COLUMNS,
    "execution_count",
    "work_seconds",
    "work_minutes",
    "first_started_at",
    "last_ended_at",
  ];

  const rows: CsvCell[][] = [];

  for (const { plan, todos: planTodos } of groupTodosByPlan(plans, todos)) {
    if (planTodos.length === 0) {
      rows.push([...planCells(plan), ...todoCells(null), null, null, null, null, null]);
      continue;
    }

    for (const todo of planTodos) {
      const executions = todo.executions ?? [];
      const seconds = executions.reduce(
        (sum, execution) => sum + executionSeconds(execution, nowMs),
        0
      );
      const workSeconds = Math.round(seconds);

      const starts = executions
        .map((e) => e.started_at)
        .filter((value): value is string => !!value)
        .sort();
      const ends = executions
        .map((e) => e.ended_at)
        .filter((value): value is string => !!value)
        .sort();

      rows.push([
        ...planCells(plan),
        ...todoCells(todo),
        executions.length,
        workSeconds,
        toMinutes(workSeconds),
        starts[0] ?? null,
        ends[ends.length - 1] ?? null,
      ]);
    }
  }

  return { columns, rows };
}

// type=executions: 실행 한 번이 한 행. 계획과 할 일의 제목을 함께 붙인다.
function buildExecutionRows(plans: PlanRow[], todos: TodoRow[], nowMs: number) {
  const columns = [
    "plan_id",
    "plan_title",
    "todo_id",
    "todo_title",
    "todo_deleted_at",
    "execution_id",
    "status",
    "started_at",
    "ended_at",
    "work_seconds",
    "work_minutes",
    "recorded_actual_minutes",
    "segment_count",
    "blocker_reason",
  ];

  const rows: CsvCell[][] = [];

  for (const { plan, todos: planTodos } of groupTodosByPlan(plans, todos)) {
    for (const todo of planTodos) {
      const executions = [...(todo.executions ?? [])].sort((a, b) =>
        (a.started_at ?? "").localeCompare(b.started_at ?? "")
      );

      for (const execution of executions) {
        const workSeconds = Math.round(executionSeconds(execution, nowMs));

        rows.push([
          plan.id,
          plan.title,
          todo.id,
          todo.title,
          todo.deleted_at,
          execution.id,
          executionStatus(execution),
          execution.started_at,
          execution.ended_at,
          workSeconds,
          toMinutes(workSeconds),
          execution.actual_minutes,
          (execution.execution_segments ?? []).length,
          execution.blocker_reason,
        ]);
      }
    }
  }

  return { columns, rows };
}

// ---------------------------------------------------------------------------
// 응답
// ---------------------------------------------------------------------------

// 읽기 → CSV 파일 응답. planId가 null이면 전체 계획.
export async function exportCsvResponse(
  supabase: SupabaseClient,
  options: { planId: string | null; ownerId?: string; type: ExportType; label: string }
) {
  const loaded = await loadExportData(supabase, options.planId, options.ownerId ?? null);

  if (!loaded.ok) {
    if (loaded.notFound) {
      return errorResponse("계획을 찾을 수 없습니다.", 404);
    }

    return dbErrorResponse(loaded.error ?? {}, options.label);
  }

  const nowMs = Date.now();
  const { columns, rows } =
    options.type === "executions"
      ? buildExecutionRows(loaded.plans, loaded.todos, nowMs)
      : buildTodoRows(loaded.plans, loaded.todos, nowMs);

  const csv = toCsv(columns, rows);
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const scope = options.planId ? `plan-${options.planId.slice(0, 8)}` : "all-plans";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="plan-do-see-${scope}-${options.type}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
