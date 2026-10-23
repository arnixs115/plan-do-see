import { requireUser } from "@/lib/auth/require-user";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { errorResponse, isUuid } from "@/lib/api-utils";
import {
  emptyResultResponse,
  executionErrorResponse,
  type ExecutionResult,
} from "@/lib/execution-api";

type RouteContext = {
  params: Promise<{ execution_id: string }>;
};

// POST: 일시 정지(PAUSE). 열려 있는 구간을 닫는다.
//  - 이미 일시 정지 상태면 아무것도 바꾸지 않고 현재 상태를 200으로 돌려준다. (changed: false)
//  - 이미 종료된 실행이면 409.
export async function POST(
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

  const { data, error } = await supabase.rpc("pause_execution", {
    p_execution_id: execution_id,
  });

  if (error) {
    return executionErrorResponse(
      error,
      "POST /api/executions/[execution_id]/pause",
      "실행을 찾을 수 없습니다."
    );
  }

  const result = data as ExecutionResult | null;

  if (!result) {
    return emptyResultResponse("POST /api/executions/[execution_id]/pause");
  }

  return NextResponse.json(result);
}
