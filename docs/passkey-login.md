# 패스키 로그인·로그아웃 (과제 8 카드 3)

카드 2에서 등록한 패스키로 **아이디·비밀번호 입력 없이** 로그인한다. 이메일/비밀번호 로그인(과제 7)은 그대로 있다. 패스키 삭제·두 개 이상의 패스키 검증은 카드 4다.

## 흐름

1. 로그인 화면(`/login`)의 「패스키로 로그인」 → `POST /api/passkeys/login/options`
   서버가 챌린지를 만들어 DB에 저장하고 `{challenge_id, options}` 를 준다. 요청에 계정 정보가 없고, 옵션에도 계정 지정(`allowCredentials`)이 없다. 브라우저가 이 사이트의 패스키 중에서 사용자가 고르게 한다.
2. 브라우저가 `navigator.credentials.get()`(라이브러리 `startAuthentication`)으로 인증기에서 서명을 만든다. 개인 키는 인증기 밖으로 나오지 않는다.
3. `POST /api/passkeys/login/verify` 에 `{challenge_id, response}` 를 보낸다.
4. 서버가 검증하고, 통과했을 때만 세션 쿠키를 발급한다. 본문은 `{ok, redirect_to}` 뿐이고 세션 값은 들어 있지 않다.
5. 화면이 `/plans` 로 이동한다.

## 서버 검증 (`app/api/passkeys/login/verify/route.ts`)

| 순서 | 확인 | 실패 시 |
| --- | --- | --- |
| 1 | 설정, Origin 헤더, 요청 모양 | 503 / 403 / 400 |
| 2 | 챌린지 **원자적 소비** (`consume_login_challenge`: 안 쓰임·안 만료일 때만 UPDATE ... RETURNING) | 400 |
| 3 | 응답의 credential ID 로 저장된 패스키 찾기. **사용자는 여기서 저장된 소유자로 정해진다** | 401 |
| 4 | 인증기가 준 userHandle 이 있으면 저장된 소유자와 일치 | 401 |
| 5 | `verifyAuthenticationResponse`: 챌린지, origin, RP ID, 사용자 확인(UV), **저장된 공개 키로 서명 검증**, 서명 카운터 | 401 |
| 6 | 카운터 기록(`record_passkey_authentication`): 저장값보다 커야 함(둘 다 0 이면 허용) | 401 |
| 7 | 세션 발급 | 503 |

- 요청 본문의 사용자 id, 이메일, "인증 성공" 같은 값은 읽지 않는다. 브라우저가 보낸 값 중 서버가 믿는 것은 서명과 그것이 담긴 인증 데이터뿐이고, 그것을 저장된 공개 키로 검증한다.
- 3~6 의 실패 응답은 모두 같은 문구의 401 이다. 어떤 패스키가 등록돼 있는지 알아내는 데 쓸 수 없다. 이유는 서버 로그(`[passkey-login] verify.failed ... reason=...`)에만 남고, 로그에는 챌린지·서명·토큰 원문을 쓰지 않는다.
- 2 에서 소비된 챌린지는 검증이 실패해도 다시 쓸 수 없다. 다시 시도하려면 로그인을 처음부터 시작한다. 만료된 것은 소비되지 않고 거절된다.

## 챌린지 (`passkey_login_challenges`)

- 요청마다 새 난수(32바이트, base64url). 서버리스에서 인스턴스가 바뀌어도 쓸 수 있게 메모리가 아니라 **DB**에 둔다.
- 만료는 DB 시계 기준 5분. 로그인 시작 시점에는 누구인지 모르므로 사용자 열이 없다.
- 동시 요청: 소비가 UPDATE 한 문장이라 같은 챌린지를 5개 동시에 보내도 하나만 성공한다.

## 세션 발급과 무효화

이 프로젝트의 세션은 Supabase Auth 가 만든다(과제 7: httpOnly 쿠키 `sb-*`, 모든 API 는 `requireUser` 의 `getUser()` 로 서버가 확인). 패스키 로그인도 **같은 세션**을 쓴다. 두 번째 세션 체계를 만들지 않아서 기존 API 의 인증 확인, 갱신, 로그아웃이 그대로 동작한다.

발급(`lib/auth/passkey-session.ts`): 서명 검증이 끝난 사용자(저장된 패스키의 소유자)에 대해
1. 서버 전용 키로 일회용 로그인 링크 값(`generateLink`, magiclink)을 만든다. 메일은 보내지 않고 이 값은 서버 밖으로 나가지 않는다.
2. 쿠키와 연결된 서버용 클라이언트로 `verifyOtp` 를 호출해 세션으로 바꾼다. 쿠키는 HttpOnly, Secure(운영), SameSite=Lax 로 심어진다.
3. 세션의 사용자가 기대한 사용자와 같은지 한 번 더 확인한다.

쿠키 수명: `@supabase/ssr` 기본 400일을 **7일**로 줄였다(`lib/auth/cookie-options.ts`). 토큰이 갱신될 때마다 다시 쓰이므로 "마지막 사용 후 7일"이다. 서버 쪽 수명(액세스 토큰 기본 1시간, 선택 기능인 세션 최대 수명·비활동 제한)은 코드가 아니라 **Supabase 프로젝트 설정**이다.

무효화(`POST /api/auth/logout`, `lib/auth/sign-out.ts`): `signOut({scope:"local"})` 로 이 기기의 세션을 Supabase Auth 에서 폐기하고 `sb-*` 쿠키를 지운다. 이후 같은 토큰으로 `requireUser` 를 거치면 Auth 서버가 거절한다(`getUser()` 가 서버에 직접 묻기 때문). 화면의 로그아웃 버튼은 이 경로로 `<form method="post">` 를 보낸다. 페이지가 통째로 다시 불러와져서, 로그아웃 뒤 "뒤로 가기"로 Next.js 클라이언트 캐시의 옛 화면이 되살아나지 않는다.

뒤로 가기·새로고침: 로그인해야 보이는 화면은 `Cache-Control: no-store`(`proxy.ts`), bfcache 로 되살려지면 다시 불러온다(`app/back-forward-guard.tsx`). 서버는 매 요청마다 로그인을 확인한다.

## API

| 경로 | 인증 | 역할 |
| --- | --- | --- |
| `POST /api/passkeys/login/options` | 없음 | 챌린지 발급 |
| `POST /api/passkeys/login/verify` | 없음(서명으로 인증) | 검증 + 세션 발급 |
| `POST /api/auth/logout` | 쿠키(없어도 204) | 세션 폐기 + 쿠키 삭제. 폼 제출(Accept: text/html)이면 303 → `/login` |
| `GET /api/private-items` | `requireUser` | 비공개 항목 (카드 1, 그대로) |

비공개 데이터 접근 제어는 카드 1과 같은 위치다: API 는 `requireUser`(`lib/auth/require-user.ts`), 화면은 `getCurrentUser()`(`/private`, `/plans`, `/account`). 패스키 로그인이 만든 세션이 같은 확인을 통과한다. 테스트용 우회 코드·하드코딩된 사용자는 없다.

## 보안상 한계

- 로그인 전 두 API 는 누구나 호출할 수 있다. 챌린지 행이 쌓일 수 있고(만료 1시간 뒤 다음 발급 때 정리), 요청 횟수 제한은 구현하지 않았다. 필요하면 Vercel 방화벽/Rate limit 을 쓴다.
- 패스키는 로그인한 상태에서만 등록된다. 비밀번호 계정이 없는 사람이 패스키만으로 가입하는 흐름은 없다("나만 들어가기"의 가입 정책은 아직 정하지 않았다).
- 세션 발급은 `generateLink`+`verifyOtp` 방식이라 해당 계정의 이메일이 있어야 한다.
- 카운터 0 을 계속 보내는 동기화 패스키는 복제 탐지가 되지 않는다(표준 동작).
- 서버 쪽 세션 만료·폐기의 실제 동작은 Supabase Auth 에 달려 있고, 이 저장소의 시험은 가짜 Auth 서버로 한 것이다. 실제 프로젝트에서는 아래 수동 절차로 확인한다.

## 직접 확인하는 절차 (실제 브라우저·Supabase)

1. 마이그레이션 `db/migrations/20261031120000_add_passkey_login.sql` 을 SQL Editor 에서 실행, 재배포.
2. 로그인한 상태로 `/account` 에서 패스키를 등록한다(카드 2). 로그아웃한다.
3. `/login` → 「패스키로 로그인」 → 패스키 선택 → `/plans` 로 이동하는지 본다.
4. 개발자 도구 > Application > Cookies 에서 `sb-…` 쿠키가 **HttpOnly**, Secure, SameSite=Lax 인지만 본다. **값은 화면에 담지 않는다.** 콘솔에서 `document.cookie` 에 `sb-` 가 없는지 본다.
5. 로그아웃 → `/login` 으로 이동. 브라우저 뒤로 가기, 새로고침 → 비공개 화면이 안 보이고 로그인 화면이 나온다.
6. 패스키 창에서 취소 → 안내 문구, 로그인되지 않음.
7. (선택) 로그인 상태에서 Network 탭의 `/api/private-items` 요청을 "Copy as fetch" 하지 말고, 로그아웃 후 같은 주소를 새로고침해 401 이 나오는지 본다. 토큰·쿠키는 캡처에 넣지 않는다.
8. Supabase 대시보드 > Authentication > Users 에서 해당 사용자의 마지막 로그인 시각이 갱신됐는지, SQL Editor 에서 `db/checks/passkey-registration.sql` 의 7~9번을 실행해 챌린지가 `consumed` 로 늘고 `last_used_at` 이 기록됐는지 본다.
9. 서버 로그(Vercel > Logs)에서 `[passkey-login]` 줄(`challenge.issued`, `challenge.consumed`, `verify.succeeded|failed`, `session.issued`)을 확인한다.
