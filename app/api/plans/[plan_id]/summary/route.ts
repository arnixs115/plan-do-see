import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { dbErrorResponse, errorResponse, isUuid } from "@/lib/api-utils";

type RouteContext = {
  params: Promise<{ plan_id: string }>;
};

// DB 함수(plan_summary)가 돌려주는 요약의 모양
type PlanSummary = {
  plan: Record<string, unknown>;
  revision_count: number;
  todo_counts: {
    total: number;
    todo: number;
    in_progress: number;
    completed: number;
  };
  // 할 일이 하나도 없으면 null
  completion_rate: number | null;
  estimated_minutes: { plan: number; todos: number };
  actual: {
    execution_count: number;
    active_execution_count: number;
    work_seconds: number;
  };
  todos: {
    id: string;
    title: string;
    status: string;
    estimated_minutes: number;
    execution_count: number;
    active_execution_count: number;
    work_seconds: number;
  }[];
};

// 초 → 분 (소수 첫째 자리까지 반올림). 예상 시간(estimated_minutes)과 같은 단위로 비교하기 위한 값이다.
// 분 값은 초 값에서 파생되므로 DB에는 저장하지 않고 응답을 만들 때 계산한다.
function toMinutes(seconds: number) {
  return Math.round((seconds / 60) * 10) / 10;
}

// GET: 계획 대비 실제 실행 결과 요약 (See)
//  - 통계는 저장하지 않고 요청할 때마다 DB 함수가 todos / executions / execution_segments에서 계산한다.
//  - 삭제된 할 일과 그 실행 기록은 집계에서 제외된다.
//  - 작업 시간은 일시 정지 시간을 뺀 실행 구간의 합이고, 진행 중인 구간은 지금까지로 계산한다.
//    초(work_seconds)와 분(work_minutes)을 함께 돌려준다. (계획 합계와 할 일별 모두)
export async function GET(
  request: Request,
  { params }: RouteContext
) {
  const { plan_id } = await params;

  if (!isUuid(plan_id)) {
    return errorResponse("plan_id가 올바른 형식이 아닙니다.", 400);
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("plan_summary", {
    p_plan_id: plan_id,
  });

  if (error) {
    // 함수 안에서 raise exception ... errcode 'P0002' 로 던진 "계획 없음"
    if (error.code === "P0002") {
      return errorResponse("계획을 찾을 수 없습니다.", 404);
    }

    return dbErrorResponse(error, "GET /api/plans/[plan_id]/summary");
  }

  if (!data) {
    console.error("GET /api/plans/[plan_id]/summary: 함수가 빈 결과를 반환했습니다.");
    return errorResponse("서버 오류가 발생했습니다.", 500);
  }

  const summary = data as PlanSummary;

  return NextResponse.json({
    ...summary,
    actual: {
      ...summary.actual,
      work_minutes: toMinutes(summary.actual.work_seconds),
    },
    todos: summary.todos.map((todo) => ({
      ...todo,
      work_minutes: toMinutes(todo.work_seconds),
    })),
  });
}
