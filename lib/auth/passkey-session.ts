import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { createAuthClient } from "./client";

// 패스키 서명 검증이 끝난 사용자에게 로그인 세션을 발급한다. (카드 3)
//
// 이 프로젝트의 세션은 Supabase Auth 가 만든다. (과제 7: httpOnly 쿠키 sb-*, 모든 API가 requireUser 로 확인)
// 패스키 로그인도 같은 세션을 쓰는 것이 맞다. 그래야 기존 API·화면의 인증 확인, 로그아웃(세션 폐기), 만료·갱신이 그대로 동작하고
// "패스키로 만든 세션"과 "비밀번호로 만든 세션"을 따로 관리하는 두 번째 세션 체계가 생기지 않는다.
//
// 방법
//  1) 서버 전용 키로 사용자의 일회용 로그인 링크 값(hashed_token)을 만든다. 메일은 보내지 않고, 이 값은 서버 밖으로 나가지 않는다.
//  2) 쿠키와 연결된 서버용 클라이언트로 verifyOtp 를 호출해 그 값을 세션으로 바꾼다. 세션이 httpOnly 쿠키로 심어진다.
// 호출하는 쪽은 "이 사용자가 방금 패스키로 인증되었다"가 서버에서 확인된 뒤에만 이 함수를 불러야 한다.
// userId 는 서버가 저장된 패스키에서 얻은 값이어야 하고, 요청에서 받은 값을 넘기면 안 된다.
export async function issueSessionForUser(userId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const admin = getSupabaseAdmin();

    const found = await admin.auth.admin.getUserById(userId);
    const email = found.data.user?.email;

    if (found.error || !email) {
      return { ok: false, reason: "user_lookup_failed" };
    }

    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link.data?.properties?.hashed_token;

    if (link.error || !tokenHash) {
      return { ok: false, reason: "link_failed" };
    }

    const supabase = await createAuthClient();
    const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });

    if (verified.error || !verified.data.session || verified.data.user?.id !== userId) {
      return { ok: false, reason: "session_failed" };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "session_error" };
  }
}
