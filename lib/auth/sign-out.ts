import "server-only";
import { cookies } from "next/headers";
import { createAuthClient } from "./client";

// 현재 로그인 세션을 서버에서 폐기하고 브라우저의 로그인 쿠키를 지운다. (로그아웃 버튼과 POST /api/auth/logout 이 함께 쓴다)
//  - 이 기기의 세션만 폐기한다. (scope: local) Supabase Auth 에서 세션이 사라지므로, 같은 토큰으로 requireUser 를 거치는 API를 부르면 거절된다.
//  - 폐기에 실패하더라도(이미 만료된 세션 등) 브라우저의 sb-* 쿠키는 반드시 지운다.
export async function signOutCurrentSession(): Promise<void> {
  try {
    const supabase = await createAuthClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // 아래 쿠키 삭제로 계속 진행한다.
  }

  const cookieStore = await cookies();

  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      cookieStore.delete(cookie.name);
    }
  }
}
