import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  dbErrorResponse,
  errorResponse,
  isUuid,
  readJsonObject,
} from "@/lib/api-utils";
import { validateTodoInput } from "@/lib/todo-validation";

type RouteContext = {
  params: Promise<{ todo_id: string }>;
};

const BAD_ID_MESSAGE = "todo_id가 올바른 형식이 아닙니다.";
const NOT_FOUND_MESSAGE = "할 일을 찾을 수 없습니다.";

// 삭제(소프트 삭제)된 할 일은 조회·수정·삭제 모두에서 "없는 것"으로 취급한다.

export async function GET(
  request: Request,
  { params }: RouteContext
) {
  const { todo_id } = await params;

  if (!isUuid(todo_id)) {
    return errorResponse(BAD_ID_MESSAGE, 400);
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .eq("id", todo_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return dbErrorResponse(error, "GET /api/todos/[todo_id]");
  }

  if (!data) {
    return errorResponse(NOT_FOUND_MESSAGE, 404);
  }

  return NextResponse.json(data);
}

// PATCH: 들어온 필드만 수정한다. 상태(status) 변경도 여기서 처리한다.
// UPDATE 한 문장이라 그 자체로 원자적이다. 삭제된 항목은 조건에서 걸러져 0행이 갱신된다.
export async function PATCH(
  request: Request,
  { params }: RouteContext
) {
  const { todo_id } = await params;

  if (!isUuid(todo_id)) {
    return errorResponse(BAD_ID_MESSAGE, 400);
  }

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { values, errors } = validateTodoInput(parsed.body, "update");

  if (errors.length > 0) {
    return errorResponse(errors, 400);
  }

  if (Object.keys(values).length === 0) {
    return errorResponse("수정할 항목이 없습니다.", 400);
  }

  const supabase = getSupabaseAdmin();

  // DB에 updated_at을 자동 갱신하는 트리거가 없어서 여기서 직접 넣는다.
  const { data, error } = await supabase
    .from("todos")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", todo_id)
    .is("deleted_at", null)
    .select();

  if (error) {
    return dbErrorResponse(error, "PATCH /api/todos/[todo_id]");
  }

  if (!data || data.length === 0) {
    return errorResponse(NOT_FOUND_MESSAGE, 404);
  }

  return NextResponse.json(data[0]);
}

// DELETE: 소프트 삭제. 행을 지우지 않고 deleted_at만 채운다. (executions 기록 보존)
export async function DELETE(
  request: Request,
  { params }: RouteContext
) {
  const { todo_id } = await params;

  if (!isUuid(todo_id)) {
    return errorResponse(BAD_ID_MESSAGE, 400);
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("todos")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", todo_id)
    .is("deleted_at", null)
    .select("id");

  if (error) {
    return dbErrorResponse(error, "DELETE /api/todos/[todo_id]");
  }

  // 이미 삭제됐거나 없는 항목
  if (!data || data.length === 0) {
    return errorResponse(NOT_FOUND_MESSAGE, 404);
  }

  return new NextResponse(null, { status: 204 });
}
