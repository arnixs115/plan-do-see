import { requireUser } from "@/lib/auth/require-user";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  dbErrorResponse,
  errorResponse,
  isUuid,
  readJsonObject,
} from "@/lib/api-utils";
import { fetchActiveExecutions } from "@/lib/active-execution";
import { validateTodoInput } from "@/lib/todo-validation";

type RouteContext = {
  params: Promise<{ plan_id: string }>;
};

// GET: 계획에 속한 할 일 목록 (삭제된 항목은 제외, 오래된 순).
//      각 항목에 active_execution(진행 중인 실행 또는 null)이 함께 들어 있다.
export async function GET(
  request: Request,
  { params }: RouteContext
) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { plan_id } = await params;

  if (!isUuid(plan_id)) {
    return errorResponse("plan_id가 올바른 형식이 아닙니다.", 400);
  }

  const supabase = getSupabaseAdmin();

  // 계획이 없는데 빈 목록을 돌려주면 "할 일이 없음"과 구분되지 않으므로 먼저 확인한다.
  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id")
    .eq("id", plan_id)
    .maybeSingle();

  if (planError) {
    return dbErrorResponse(planError, "GET /api/plans/[plan_id]/todos");
  }

  if (!plan) {
    return errorResponse("계획을 찾을 수 없습니다.", 404);
  }

  const { data, error } = await supabase
    .from("todos")
    .select("*")
    .eq("plan_id", plan_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    return dbErrorResponse(error, "GET /api/plans/[plan_id]/todos");
  }

  // 각 할 일에 "진행 중인 실행"(없으면 null)을 덧붙인다. 기존 필드는 그대로다.
  const active = await fetchActiveExecutions(supabase, plan_id);

  if (!active.ok) {
    return dbErrorResponse(active.error, "GET /api/plans/[plan_id]/todos (active)");
  }

  return NextResponse.json(
    data.map((todo) => ({ ...todo, active_execution: active.byTodo.get(todo.id) ?? null }))
  );
}

// POST: 계획에 할 일 추가. plan_id는 경로에서 받고, 본문의 plan_id는 무시한다.
export async function POST(
  request: Request,
  { params }: RouteContext
) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { plan_id } = await params;

  if (!isUuid(plan_id)) {
    return errorResponse("plan_id가 올바른 형식이 아닙니다.", 400);
  }

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { values, errors } = validateTodoInput(parsed.body, "create");

  if (errors.length > 0) {
    return errorResponse(errors, 400);
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("todos")
    .insert({ ...values, plan_id })
    .select()
    .single();

  if (error) {
    // 23503: 외래 키 위반 → 해당 plan_id의 계획이 없다.
    if (error.code === "23503") {
      return errorResponse("계획을 찾을 수 없습니다.", 404);
    }

    return dbErrorResponse(error, "POST /api/plans/[plan_id]/todos");
  }

  return NextResponse.json(data, { status: 201 });
}
