import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/auth/client";

// 가입 확인 메일의 링크가 도착하는 곳.
//  - ?token_hash=...&type=email : 메일 템플릿을 아래처럼 바꿨을 때. 다른 기기·브라우저에서 열어도 동작한다.
//        {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
//  - ?code=...                  : 기본 메일 템플릿(PKCE). 가입을 시작한 같은 브라우저에서 열어야 동작한다.
// 성공하면 로그인된 채로 계획 화면(/plans)으로, 실패하면 로그인 화면에 안내를 붙여 보낸다.
// 돌아갈 주소(next)는 받지 않는다. 항상 "/plans" 로 보내서 임의 주소로 보내는 공격(open redirect)을 막는다.

const CONFIRM_TYPES = new Set(["email", "signup"]);

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");

  const supabase = await createAuthClient();

  try {
    if (tokenHash && type && CONFIRM_TYPES.has(type)) {
      const { error } = await supabase.auth.verifyOtp({ type: type as "email" | "signup", token_hash: tokenHash });

      if (!error) return redirectTo(request, "/plans");
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) return redirectTo(request, "/plans");
    }
  } catch (error) {
    console.error("GET /auth/confirm failed:", error);
  }

  return redirectTo(request, "/login?confirm=failed");
}
