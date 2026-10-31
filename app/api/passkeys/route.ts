import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { dbErrorResponse } from "@/lib/api-utils";
import { listPasskeys } from "@/lib/passkeys/store";

// GET: 로그인한 사용자 본인의 패스키 목록 (이름, 등록 일시, 기기 종류, 모델 식별값).
//
//  * 맨 앞에서 requireUser() 로 로그인을 확인한다. 로그인하지 않았으면 DB에 닿기 전에 401.
//  * 조회 조건의 사용자 id 는 로그인 세션에서 나온 값이다. 요청에서 사용자 id 를 받지 않으므로 남의 패스키는 조회할 수 없다.
//  * credential_id, 공개 키, 카운터는 응답에 넣지 않는다.
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await listPasskeys(auth.user.id);

  if (error || !data) {
    return dbErrorResponse(error ?? {}, "GET /api/passkeys");
  }

  return NextResponse.json({ passkeys: data }, { headers: { "Cache-Control": "no-store" } });
}
