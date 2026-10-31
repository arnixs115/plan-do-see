// 로그인 쿠키에 붙일 보안 속성.
// @supabase/ssr 의 기본값은 httpOnly: false (브라우저용 Supabase 클라이언트가 쿠키를 읽을 수 있게 하려는 것)다.
// 이 프로젝트는 브라우저에서 Supabase를 직접 부르지 않고 항상 서버 API를 거치므로, 자바스크립트가
// 세션 쿠키를 읽을 필요가 없다. 그래서 httpOnly 를 켜서, 화면에 악성 스크립트가 들어와도
// 로그인 토큰을 꺼내 가지 못하게 한다.
//  - secure: 운영(https)에서만 켠다. 로컬 개발(http://localhost)에서는 켜면 쿠키가 저장되지 않는다.
//  - sameSite: 라이브러리 기본값(lax)을 그대로 둔다.
// proxy.ts 에서도 쓰므로 server-only 를 붙이지 않았다.

//  - maxAge: @supabase/ssr 의 기본값은 400일이다. 로그인 쿠키가 그렇게 오래 남지 않도록 7일로 줄인다.
//    세션 쿠키는 토큰이 갱신될 때마다 다시 쓰이므로 "마지막으로 사용한 뒤 7일"이다. (삭제 요청의 maxAge 0 은 그대로 둔다)
//    서버에서의 세션 수명(액세스 토큰 1시간 등)은 Supabase 프로젝트 설정이다. (docs/passkey-login.md)

type CookieOptionsLike = Record<string, unknown>;

export const SESSION_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function hardenCookieOptions<T extends CookieOptionsLike>(options: T): T {
  const maxAge = options.maxAge;

  return {
    ...options,
    ...(typeof maxAge === "number" && maxAge > SESSION_COOKIE_MAX_AGE_SECONDS ? { maxAge: SESSION_COOKIE_MAX_AGE_SECONDS } : {}),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };
}
