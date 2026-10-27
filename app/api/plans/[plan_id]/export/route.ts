import { requireUser } from "@/lib/auth/require-user";
import { authorizePlan } from "@/lib/auth/ownership";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { errorResponse, isUuid } from "@/lib/api-utils";
import { exportCsvResponse, parseExportType } from "@/lib/export";

type RouteContext = {
  params: Promise<{ plan_id: string }>;
};

// GET: 계획 하나를 CSV 파일로 내보낸다.
//   ?type=todos       (기본) 할 일 한 개가 한 행. 계획 정보와 실제 작업 시간이 함께 들어간다.
//   ?type=executions  실행 한 번이 한 행.
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

  const parsed = parseExportType(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const supabase = getSupabaseAdmin();

  // 내 계획이거나 예시 계획만 내보낼 수 있다. 남의 계획은 없는 것과 같은 404.
  const access = await authorizePlan(supabase, auth.user, plan_id, "read", "GET /api/plans/[plan_id]/export");
  if (!access.ok) return access.response;

  return exportCsvResponse(supabase, {
    planId: plan_id,
    type: parsed.type,
    label: "GET /api/plans/[plan_id]/export",
  });
}
