import { requireUser } from "@/lib/auth/require-user";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { exportCsvResponse, parseExportType } from "@/lib/export";

// GET: 모든 계획을 CSV 파일 하나로 내보낸다.
//   ?type=todos       (기본) 할 일 한 개가 한 행. 할 일이 없는 계획도 한 행으로 나온다.
//   ?type=executions  실행 한 번이 한 행.
//
// 로그인한 사용자의 계획과, 모든 사용자에게 보이는 예시 계획만 내보낸다. (다른 사용자의 계획은 포함되지 않는다)
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const parsed = parseExportType(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  return exportCsvResponse(getSupabaseAdmin(), {
    planId: null,
    ownerId: auth.user.id,
    type: parsed.type,
    label: "GET /api/export",
  });
}
