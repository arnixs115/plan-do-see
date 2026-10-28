import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/require-user";
import { confirmationMatches } from "@/lib/auth/account-deletion";
import { classifyAuthError } from "@/lib/auth/validation";
import { errorResponse, readJsonObject } from "@/lib/api-utils";
import { getSupabaseAdmin } from "@/lib/supabase-server";

// DELETE: 로그인한 본인의 계정을 지운다. (되돌릴 수 없다)
//
//  * 요청 본문: { "confirm_email": "<내 계정 이메일>" }  — 계정 이메일과 다르면 400. 아무것도 지우지 않는다.
//  * 지울 계정은 항상 로그인한 사용자다. 요청에 사용자 ID를 받지 않는다. (남의 계정은 지울 수 없다)
//  * 삭제는 Supabase Auth 의 사용자 삭제(auth.admin.deleteUser) 한 번이다.
//    DB의 외래 키가 연쇄 삭제(on delete cascade)라서 사용자 → 내 계획 → 할 일 → 실행 → 실행 구간,
//    계획의 수정 기록(plan_revisions), admins 등록이 함께 지워지고, 그 사용자의 세션·리프레시 토큰도 Auth가 지운다.
//    소유자가 없는 예시 계획과 다른 사용자의 자료는 영향을 받지 않는다.
//  * 성공하면 204 와 함께 이 브라우저의 로그인 쿠키를 지운다. 이전 토큰은 사용자가 없으므로 더는 통하지 않는다.
export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  if (!confirmationMatches(parsed.body.confirm_email, auth.user.email)) {
    return errorResponse("확인용 이메일이 내 계정의 이메일과 일치하지 않습니다.", 400);
  }

  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(auth.user.id);

  if (error) {
    console.error("DELETE /api/account failed:", error.name, error.status);

    return classifyAuthError(error) === "unavailable"
      ? errorResponse("인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.", 503)
      : errorResponse("계정을 지우지 못했습니다.", 500);
  }

  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const cookieStore = await cookies();

  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      response.cookies.delete(cookie.name);
    }
  }

  return response;
}
