import { requireUser } from "@/lib/auth/require-user";
import { authorizeTodo } from "@/lib/auth/ownership";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { errorResponse, isUuid } from "@/lib/api-utils";
import {
  emptyResultResponse,
  executionErrorResponse,
  readIdempotencyKey,
  type ExecutionResult,
} from "@/lib/execution-api";

type RouteContext = {
  params: Promise<{ todo_id: string }>;
};

// POST: 실행 시작(START)
//  - Idempotency-Key 헤더가 필요하다. 네트워크 재시도처럼 같은 요청이 다시 오면
//    같은 키를 쓰게 해서, 실행 기록이 중복으로 만들어지지 않게 한다.
//  - 새로 만들었으면 201, 같은 키의 재요청이라 기존 실행을 돌려주면 200.
//  - 이미 진행 중인 실행이 있는데 다른 키로 오면 409.
export async function POST(
  request: Request,
  { params }: RouteContext
) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { todo_id } = await params;

  if (!isUuid(todo_id)) {
    return errorResponse("todo_id가 올바른 형식이 아닙니다.", 400);
  }

  const key = readIdempotencyKey(request);

  if (!key.ok) {
    return key.response;
  }

  const supabase = getSupabaseAdmin();

  // 내 계획의 할 일에만 실행을 시작할 수 있다. (예시는 admin만, 남의 것은 404)
  const access = await authorizeTodo(supabase, auth.user, todo_id, "write", "POST /api/todos/[todo_id]/executions");
  if (!access.ok) return access.response;

  const { data, error } = await supabase.rpc("start_execution", {
    p_todo_id: todo_id,
    p_idempotency_key: key.key,
  });

  if (error) {
    return executionErrorResponse(
      error,
      "POST /api/todos/[todo_id]/executions",
      "할 일을 찾을 수 없습니다."
    );
  }

  const result = data as ExecutionResult | null;

  if (!result) {
    return emptyResultResponse("POST /api/todos/[todo_id]/executions");
  }

  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}
