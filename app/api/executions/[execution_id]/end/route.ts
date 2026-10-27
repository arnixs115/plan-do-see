import { requireUser } from "@/lib/auth/require-user";
import { authorizeExecution } from "@/lib/auth/ownership";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { errorResponse, isUuid, readJsonObject } from "@/lib/api-utils";
import { checkText } from "@/lib/validation-common";
import {
  emptyResultResponse,
  executionErrorResponse,
  type ExecutionResult,
} from "@/lib/execution-api";

type RouteContext = {
  params: Promise<{ execution_id: string }>;
};

const MAX_BLOCKER_LENGTH = 2000;

// POST: 종료(END). 열려 있는 구간을 닫고 실행을 끝낸다.
//  - 본문은 선택 사항이다. { "blocker_reason": "막힌 이유" } 를 보내면 함께 저장한다.
//  - 작업 시간(actual_minutes)은 구간 길이의 합이라 일시 정지 시간은 빠진다.
//  - 이미 종료된 실행이면 아무것도 바꾸지 않고 저장된 결과를 200으로 돌려준다. (changed: false)
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

  const parsed = await readJsonObject(request, { allowEmpty: true });

  if (!parsed.ok) {
    return parsed.response;
  }

  let blockerReason: string | null = null;

  if (Object.prototype.hasOwnProperty.call(parsed.body, "blocker_reason")) {
    const check = checkText("blocker_reason", parsed.body.blocker_reason);

    if (!check.ok) {
      return errorResponse([check.error], 400);
    }

    if (check.value.length > MAX_BLOCKER_LENGTH) {
      return errorResponse(
        [`blocker_reason은 ${MAX_BLOCKER_LENGTH}자 이하여야 합니다.`],
        400
      );
    }

    blockerReason = check.value;
  }

  const supabase = getSupabaseAdmin();

  // 내 계획의 실행만 조작할 수 있다. (예시는 admin만, 남의 것은 404)
  const access = await authorizeExecution(supabase, auth.user, execution_id, "write", "POST /api/executions/[execution_id]/end");
  if (!access.ok) return access.response;

  const { data, error } = await supabase.rpc("end_execution", {
    p_execution_id: execution_id,
    p_blocker_reason: blockerReason,
  });

  if (error) {
    return executionErrorResponse(
      error,
      "POST /api/executions/[execution_id]/end",
      "실행을 찾을 수 없습니다."
    );
  }

  const result = data as ExecutionResult | null;

  if (!result) {
    return emptyResultResponse("POST /api/executions/[execution_id]/end");
  }

  return NextResponse.json(result);
}
