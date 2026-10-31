import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";
import { signOutCurrentSession } from "@/lib/auth/sign-out";

// POST: 로그아웃. 현재 세션을 서버(Supabase Auth)에서 폐기하고 로그인 쿠키를 만료시킨다.
//  * 화면의 로그아웃 버튼은 이 경로로 <form method="post"> 를 보낸다. 브라우저가 페이지를 통째로 다시 불러오므로,
//    Next.js 가 메모리에 둔 이전 화면(클라이언트 라우터 캐시)이 남지 않는다. 그래서 로그아웃 뒤 "뒤로 가기"를 눌러도
//    비공개 화면이 서버 확인 없이 되살아나지 않고, 서버가 다시 로그인 여부를 확인한다. (화면 안에서만 상태를 바꾸는 방식이 아니다)
//  * 폼 제출(Accept: text/html)이면 303 으로 /login 에 보내고, 그 밖의 요청(스크립트·도구)은 204 로 답한다.
//  * 로그인 쿠키만으로 동작하는 요청이므로, Origin 헤더가 있으면 이 요청을 받은 주소(Host)와 같아야 한다.
//    (다른 사이트가 몰래 로그아웃시키는 것을 막음. 패스키 설정(WEBAUTHN_ORIGIN)에 의존하지 않아 어느 주소에서든 로그아웃은 된다)
//  * 이미 로그아웃된 상태여도 같은 응답이다. (멱등)
function sameHost(request: Request): boolean {
  const origin = request.headers.get("origin");

  if (origin === null) return true;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameHost(request)) {
    return errorResponse("허용되지 않은 요청 주소입니다.", 403);
  }

  await signOutCurrentSession();

  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 303, headers: { "Cache-Control": "no-store" } });
  }

  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
