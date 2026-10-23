import "server-only";
import { NextResponse } from "next/server";
import { createAuthClient } from "./client";
import { classifyAuthError } from "./validation";

export type AuthUser = { id: string; email: string | null };

type RequireUserResult =
  | { ok: true; user: AuthUser }
  | { ok: false; response: NextResponse };

function denied(message: string, status: number) {
  return {
    ok: false as const,
    response: NextResponse.json(
      { error: message },
      { status, headers: { "Cache-Control": "no-store" } }
    ),
  };
}

// 요청한 사람이 누구인지 서버에서 확인한다. (모든 API Route Handler 맨 앞에서 호출)
//  - 쿠키의 로그인 세션, 또는 `Authorization: Bearer <access token>` 헤더를 받는다.
//    (Bearer는 verify 스크립트 같은 도구용. 브라우저 화면은 쿠키를 쓴다.)
//  - 토큰 검증은 getUser()로 한다. 이 함수는 Supabase Auth 서버에 직접 물어보므로,
//    서명이 맞아도 폐기된 세션이면 거절될 수 있다. (getClaims()는 서명 검증이 중심이라 쓰지 않는다)
//  - 로그인하지 않았거나 세션이 없으면 401, 인증 서버에 닿지 못하면 503.
export async function requireUser(request: Request): Promise<RequireUserResult> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

  const supabase = await createAuthClient();

  let result;

  try {
    result = bearer ? await supabase.auth.getUser(bearer) : await supabase.auth.getUser();
  } catch (error) {
    console.error("requireUser: 인증 서버 호출 실패", error);
    return denied("인증 서버에 연결하지 못했습니다.", 503);
  }

  const { data, error } = result;

  if (error) {
    if (classifyAuthError(error) === "unavailable") {
      console.error("requireUser: 인증 서버 오류", error.name, error.status);
      return denied("인증 서버에 연결하지 못했습니다.", 503);
    }

    return denied("로그인이 필요합니다.", 401);
  }

  if (!data.user) {
    return denied("로그인이 필요합니다.", 401);
  }

  return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } };
}

// 페이지(Server Component)용: 로그인한 사용자 또는 null. 오류는 "로그인 안 함"으로 본다.
export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = await createAuthClient();

  try {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) return null;

    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}
