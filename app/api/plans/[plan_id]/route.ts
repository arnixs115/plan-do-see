import { requireUser } from "@/lib/auth/require-user";
import { authorizePlan } from "@/lib/auth/ownership";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  dbErrorResponse,
  errorResponse,
  isUuid,
  readJsonObject,
} from "@/lib/api-utils";
import { validatePlanInput } from "@/lib/plan-validation";

type RouteContext = {
  params: Promise<{ plan_id: string }>;
};

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

  // 내 계획이거나 예시 계획만 읽을 수 있다. 남의 계획은 없는 것과 같은 404.
  const access = await authorizePlan(supabase, auth.user, plan_id, "read", "GET /api/plans/[plan_id]");
  if (!access.ok) return access.response;

  // maybeSingle: 행이 없으면 오류가 아니라 data가 null로 돌아온다.
  // (single()은 행이 없을 때 오류를 내서 "없음"과 "DB 오류"를 구분하기 어렵다.)
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("id", plan_id)
    .maybeSingle();

  if (error) {
    return dbErrorResponse(error, "GET /api/plans/[plan_id]");
  }

  if (!data) {
    return errorResponse("계획을 찾을 수 없습니다.", 404);
  }

  return NextResponse.json(data);
}

type UpdatePlanResult = {
  revision_no: number;
  plan: Record<string, unknown>;
};

// PATCH: 수정 전 내용을 revision으로 보존한 뒤 계획을 갱신한다.
// 보존과 갱신은 DB 함수(update_plan_with_revision) 안에서 하나의 트랜잭션으로 처리된다.
export async function PATCH(
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

  const { values, errors } = validatePlanInput(parsed.body, "update");

  if (errors.length > 0) {
    return errorResponse(errors, 400);
  }

  if (Object.keys(values).length === 0) {
    return errorResponse("수정할 항목이 없습니다.", 400);
  }

  const supabase = getSupabaseAdmin();

  // 내 계획만 고칠 수 있다. (예시 계획은 admin만, 남의 계획은 404)
  const access = await authorizePlan(supabase, auth.user, plan_id, "write", "PATCH /api/plans/[plan_id]");
  if (!access.ok) return access.response;

  const { data, error } = await supabase.rpc("update_plan_with_revision", {
    p_plan_id: plan_id,
    p_updates: values,
  });

  if (error) {
    // 함수 안에서 raise exception ... errcode 'P0002' 로 던진 "계획 없음"
    if (error.code === "P0002") {
      return errorResponse("계획을 찾을 수 없습니다.", 404);
    }

    return dbErrorResponse(error, "PATCH /api/plans/[plan_id]");
  }

  const result = data as UpdatePlanResult | null;

  if (!result) {
    console.error("PATCH /api/plans/[plan_id]: 함수가 빈 결과를 반환했습니다.");
    return errorResponse("서버 오류가 발생했습니다.", 500);
  }

  return NextResponse.json({
    message: "계획이 수정되었습니다.",
    revision_no: result.revision_no,
    data: result.plan,
  });
}
