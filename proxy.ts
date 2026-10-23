import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getAuthConfig } from "@/lib/auth/config";
import { hardenCookieOptions } from "@/lib/auth/cookie-options";

// 페이지 요청이 들어올 때마다 (1) 로그인 세션을 갱신하고 (2) 로그인하지 않았으면 /login 으로 보낸다.
//
//  * 이 검사는 "빠른 안내"용이다. 자료를 지키는 진짜 검사는 서버의 각 API(requireUser)와
//    각 페이지(getCurrentUser)가 다시 한다. (Next.js 문서: Proxy만으로 데이터를 보호하지 않는다)
//  * 세션 확인은 getClaims() 로 한다. 만료가 가까우면 토큰을 새로 받아 쿠키에 다시 쓴다.
//  * /api 는 이 파일의 대상이 아니다. API는 requireUser 가 직접 401 을 돌려준다.

const PUBLIC_PATHS = ["/login", "/signup", "/auth/confirm"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const { url, publishableKey } = getAuthConfig();

  let response = NextResponse.next({ request });
  let cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, hardenCookieOptions(options))
        );
        // 세션 쿠키가 들어 있는 응답이 CDN 등에 저장되지 않도록 라이브러리가 요구하는 헤더
        cacheHeaders = { ...cacheHeaders, ...headers };
        Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  let signedIn = false;

  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims;
  } catch {
    signedIn = false;
  }

  const { pathname } = request.nextUrl;

  // 로그인한 사용자를 /login 에서 첫 화면으로 보내는 일은 여기서 하지 않는다.
  // getClaims()는 토큰 서명만 보므로, 로그아웃(세션 폐기) 직후에도 만료 전 토큰은 "로그인함"으로 보일 수 있다.
  // 그 상태에서 여기서 /login → / 로 보내고 / 페이지(getUser)가 다시 /login 으로 보내면 무한 반복이 된다.
  // /login, /signup 페이지가 서버에서 getUser()로 확인하고 스스로 이동한다.
  if (!signedIn && !isPublic(pathname)) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));

    // 갱신된 세션 쿠키가 있으면 리다이렉트 응답에도 그대로 실어 보낸다.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    Object.entries(cacheHeaders).forEach(([key, value]) => redirect.headers.set(key, value));

    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    // /api, Next 내부 파일, 정적 파일은 제외
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
