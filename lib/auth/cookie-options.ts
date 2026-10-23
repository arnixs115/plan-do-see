// 로그인 쿠키에 붙일 보안 속성.
// @supabase/ssr 의 기본값은 httpOnly: false (브라우저용 Supabase 클라이언트가 쿠키를 읽을 수 있게 하려는 것)다.
// 이 프로젝트는 브라우저에서 Supabase를 직접 부르지 않고 항상 서버 API를 거치므로, 자바스크립트가
// 세션 쿠키를 읽을 필요가 없다. 그래서 httpOnly 를 켜서, 화면에 악성 스크립트가 들어와도
// 로그인 토큰을 꺼내 가지 못하게 한다.
//  - secure: 운영(https)에서만 켠다. 로컬 개발(http://localhost)에서는 켜면 쿠키가 저장되지 않는다.
//  - sameSite: 라이브러리 기본값(lax)을 그대로 둔다.
// proxy.ts 에서도 쓰므로 server-only 를 붙이지 않았다.

type CookieOptionsLike = Record<string, unknown>;

export function hardenCookieOptions<T extends CookieOptionsLike>(options: T): T {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };
}
