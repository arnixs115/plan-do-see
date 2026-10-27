import { requireUser } from "@/lib/auth/require-user";
import { authorizeExecution } from "@/lib/auth/ownership";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { dbErrorResponse, errorResponse, isUuid } from "@/lib/api-utils";
import type { ExecutionResult } from "@/lib/execution-api";

type RouteContext = {
  params: Promise<{ execution_id: string }>;
};

// GET: 실행 하나의 현재 상태(진행 중 / 일시 정지 / 종료), 작업 시간, 구간 목록
export async function GET(
  request: Request,
  { params }: RouteContext
) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { execution_id } = await params;

  if (!isUuid(execution_id)) {
    return errorResponse("execution_id가 올바른 형식이 아닙니다.", 400);
  }

  const supabase = getSupabaseAdmin();

  // 내 계획이거나 예시 계획의 실행만 읽을 수 있다. 남의 것은 없는 것과 같은 404.
  const access = await authorizeExecution(supabase, auth.user, execution_id, "read", "GET /api/executions/[execution_id]");
  if (!access.ok) return access.response;

  // 없는 실행이면 함수가 null을 돌려준다.
  const { data, error } = await supabase.rpc("execution_snapshot", {
    p_execution_id: execution_id,
  });

  if (error) {
    return dbErrorResponse(error, "GET /api/executions/[execution_id]");
  }

  if (!data) {
    return errorResponse("실행을 찾을 수 없습니다.", 404);
  }

  return NextResponse.json(data as ExecutionResult);
}
