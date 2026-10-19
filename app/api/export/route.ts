import { getSupabaseAdmin } from "@/lib/supabase-server";
import { exportCsvResponse, parseExportType } from "@/lib/export";

// GET: 모든 계획을 CSV 파일 하나로 내보낸다.
//   ?type=todos       (기본) 할 일 한 개가 한 행. 할 일이 없는 계획도 한 행으로 나온다.
//   ?type=executions  실행 한 번이 한 행.
//
// 주의: 로그인이 없는 초기 버전이라, 이 주소를 아는 사람은 누구나 모든 데이터를 내려받을 수 있다.
// 외부에 공개하기 전에 접근 제한(예: 비밀 토큰 확인)을 붙여야 한다.
export async function GET(request: Request) {
  const parsed = parseExportType(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  return exportCsvResponse(getSupabaseAdmin(), {
    planId: null,
    type: parsed.type,
    label: "GET /api/export",
  });
}
