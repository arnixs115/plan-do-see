import { requireUser } from "@/lib/auth/require-user";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  dbErrorResponse,
  errorResponse,
  readJsonObject,
} from "@/lib/api-utils";
import { validatePlanInput } from "@/lib/plan-validation";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseAdmin();

  // 내 계획과, 모든 사용자에게 읽기 전용으로 보이는 예시 계획만 돌려준다.
  // (user_id는 Supabase Auth가 발급한 uuid라 그대로 조건에 넣어도 안전하다)
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .or(`user_id.eq.${auth.user.id},is_example.eq.true`)
    .order("created_at", { ascending: false });

  if (error) {
    return dbErrorResponse(error, "GET /api/plans");
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { values, errors } = validatePlanInput(parsed.body, "create");

  if (errors.length > 0) {
    return errorResponse(errors, 400);
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("plans")
    // 소유자는 요청 본문이 아니라 로그인한 사용자로 정한다. (본문의 user_id 등은 검증 단계에서 무시된다)
    .insert({ ...values, user_id: auth.user.id })
    .select()
    .single();

  if (error) {
    return dbErrorResponse(error, "POST /api/plans");
  }

  return NextResponse.json(data, { status: 201 });
}
