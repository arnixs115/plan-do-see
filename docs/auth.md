# 인증 구현 설명서 (과제 7 카드 1)

가입·로그인·로그아웃과 "로그인하지 않으면 자료를 볼 수 없게 하는 서버 측 통제"에 대한 기록입니다.
**확인한 것**과 **확인하지 못한 것**을 구분해 적었습니다. 확인하지 못한 것은 사실처럼 쓰지 않았습니다.

## 1. 선택한 방식

| 항목 | 내용 |
|---|---|
| 방식 | 인증 서비스 **Supabase Auth** (이메일 + 비밀번호, 이메일 확인 사용) |
| 쿠키 세션 처리 | 라이브러리 `@supabase/ssr` **0.12.7** |
| 클라이언트 | `@supabase/supabase-js` **2.117.2** (설치된 `@supabase/auth-js`도 2.117.2) |
| 프레임워크 | Next.js **16.3.8** (App Router, `proxy.ts`) |
| 비밀번호 해싱 | Supabase Auth가 bcrypt로 처리 (아래 3절). 이 프로젝트는 해싱을 직접 구현하지 않는다 |

설치 버전은 `package.json`과 `node_modules/*/package.json`에서 읽은 값입니다.

### 선택 이유
1. 이 프로젝트는 이미 Supabase(PostgreSQL)를 쓰고, 같은 프로젝트에 `auth.users`가 있다. 소유자 컬럼을 `auth.users(id)`에 연결하면 계정 삭제 때 자료 삭제가 기존 `ON DELETE CASCADE` 체인에 얹힌다.
2. 비밀번호 해싱, 토큰 갱신, 로그아웃 때 세션 폐기, 이메일 확인을 직접 만들지 않아도 된다. (직접 만들 때의 구현 실수 위험을 피한다)
3. 기존 구조(브라우저는 `/api/*`만 호출, 서버가 `SUPABASE_SECRET_KEY`로 DB 접근)를 유지한 채 "누가 호출했는지"만 서버에서 확인해 붙일 수 있다.

### 검토했지만 선택하지 않은 대안
| 대안 | 선택하지 않은 이유 |
|---|---|
| 직접 구현 (users 테이블, 해싱, 세션 테이블, 쿠키) | 해싱·세션 고정·토큰 폐기·이메일 확인을 모두 직접 만들어야 하고, 구현 실수가 곧 보안 결함이 된다. 과제 기간 대비 부담이 크다 |
| 인증 라이브러리 (Auth.js 등) + 자체 사용자 테이블 | 새 의존성과 어댑터 스키마가 필요하고, 이미 있는 `auth.users`와 사용자 정보가 이중으로 생긴다 |

## 2. 데이터 흐름

**가입** (`app/signup`, `app/auth/actions.ts`의 `signup`)
1. 서버에서 이메일 형식과 비밀번호(8자 이상, 72바이트 이하)를 검사한다.
2. `supabase.auth.signUp({ email, password, emailRedirectTo: <사이트>/auth/confirm })`를 호출한다.
3. 성공이든 "이미 가입된 이메일"이든 같은 안내 문구를 보여 준다. (가입 여부를 알려 주지 않기 위해)
4. Supabase가 확인 메일을 보낸다. 이메일 확인이 끝나기 전에는 로그인되지 않는다.

**이메일 확인** (`app/auth/confirm/route.ts`)
- 메일의 링크가 `/auth/confirm`으로 돌아온다. `?code=`(기본 메일 템플릿, 가입을 시작한 같은 브라우저에서 열어야 함) 또는 `?token_hash=&type=email`(메일 템플릿을 바꿨을 때, 다른 기기에서도 동작)을 처리한다.
- 성공하면 로그인된 채로 `/`로 이동한다. 실패하면 `/login`에 안내를 붙여 보낸다. 돌아갈 주소를 받지 않아 임의 주소로 보내는 공격(open redirect)이 없다.

**로그인** (`login` 액션)
1. 이메일을 정규화(공백 제거, 소문자)하고 `signInWithPassword`를 호출한다.
2. 성공하면 세션 쿠키가 설정되고 `/`로 이동한다.
3. 실패하면 이유와 관계없이 같은 문구를 보여 준다: 없는 이메일, 틀린 비밀번호, 이메일 미확인, 형식 오류. (서버 장애와 요청 과다만 다른 문구)

**요청마다 (서버 측 통제)**
- `proxy.ts`: 페이지 요청에서 세션을 갱신하고, 로그인 쿠키가 없으면 `/login`으로 보낸다. 빠른 안내용이며 `getClaims()`(토큰 서명 확인)를 쓴다. `/api`는 대상이 아니다.
- 페이지(`app/page.tsx`, `app/plans/[plan_id]/page.tsx`): 서버에서 `getUser()`로 다시 확인하고, 로그인하지 않았으면 자료 화면 대신 `/login`으로 보낸다.
- API (Route Handler 12개, 17개 메서드 전부): 맨 앞에서 `requireUser()`를 호출한다. 로그인하지 않았거나 세션이 없으면 **DB에 닿기 전에 401**을 돌려준다. 인증 서버에 닿지 못하면 503이다.
- Next.js 문서도 "Proxy만으로 데이터를 보호하지 말고 데이터에 가까운 곳에서 검사하라"고 안내한다. 그래서 proxy는 보조이고 API와 페이지가 실제 검사를 한다.

**로그아웃** (`logout` 액션, 헤더의 버튼)
1. `signOut({ scope: "local" })`로 이 기기의 세션을 서버에서 폐기한다. (다른 기기의 세션은 유지)
2. 실패해도 브라우저의 `sb-` 로그인 쿠키는 반드시 지운 뒤 `/login`으로 이동한다.

## 3. 보안 설계와 근거

| 항목 | 구현 | 근거 |
|---|---|---|
| 비밀번호 저장 | 서버는 비밀번호를 저장하지도 로그에 남기지도 않는다. Supabase Auth가 bcrypt로 해시해 저장한다 | Supabase 공식 문서 "Password security": "Supabase Auth uses bcrypt". bcrypt 비용 계수는 확인하지 못했다 |
| 비밀번호 길이 | 8자 이상, **72바이트 이하** | 문서는 "8자 미만은 권장하지 않음"이라고 한다. 72바이트는 bcrypt가 앞 72바이트만 쓴다는 일반적 성질 때문에 정했다. Supabase가 이를 초과했을 때 어떻게 처리하는지는 확인하지 못해서, 처음부터 받지 않는다 |
| 세션 | 액세스 토큰(JWT) + 1회용 리프레시 토큰, 쿠키에 저장 | 공식 문서 "Sessions": 액세스 토큰 기본 만료 1시간, 리프레시 토큰은 한 번만 사용 가능(재사용 허용 구간 기본 10초) |
| 쿠키 속성 | `HttpOnly`, `SameSite=Lax`(라이브러리 기본), 운영(https)에서 `Secure` | `lib/auth/cookie-options.ts`. 브라우저가 Supabase를 직접 부르지 않으므로 자바스크립트가 쿠키를 읽을 필요가 없어 HttpOnly를 켰다 |
| 서버의 로그인 확인 | `getUser()` (Auth 서버에 직접 확인) | 공식 문서: 폐기된 세션의 액세스 토큰도 `exp`까지는 유효하다. `getClaims()`는 서명 확인이 중심이라 로그아웃 직후 접근을 막는 데 쓰지 않았다. `getUser()`가 폐기된 토큰을 **실제로 거절하는지는 실제 Supabase로 확인해야 한다** (5절) |
| 로그아웃 범위 | `local` (이 기기) | 공식 문서: `global`은 모든 기기, `local`은 현재 세션, `others`는 나머지. JS 기본은 `global` |
| 중복 가입 | `auth.users`의 이메일 고유 인덱스 `users_email_partial_key` (DB 조회로 확인). 이미 가입된 이메일도 같은 안내를 보여 준다 | 이 프로젝트의 DB 조회 결과 |
| 로그인 오류 문구 | 항상 같은 문구 | `lib/auth/validation.ts`, 단위 시험과 브라우저 시험으로 확인 |

사용하지 않는 기능 (Free 플랜): 세션 시간 제한, 사용자당 세션 1개, 유출된 비밀번호 차단은 공식 문서상 **Pro 이상**이라 쓰지 않았다.

## 4. Supabase·배포 설정 체크리스트 (직접 확인 필요)

- Authentication → Sign In / Providers → Email: **Confirm email 켜짐** (사용자가 확인함), **Allow new users to sign up 켜짐** (사용자가 확인함)
- Authentication → URL Configuration:
  - **Site URL**: 배포 주소 (`https://plan-do-see-silk.vercel.app`)
  - **Redirect URLs**: `https://plan-do-see-silk.vercel.app/auth/confirm`, 로컬 시험용 `http://localhost:3000/auth/confirm`
  - 가입 확인 링크의 돌아올 주소는 이 허용 목록과 맞아야 한다. 맞지 않으면 Supabase가 Site URL로 보낼 수 있다. (이 동작은 직접 확인하지 못했다)
- 환경변수 추가: 로컬 `.env.local`과 Vercel에 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Project Settings > API Keys의 publishable key). 비밀 키(`SUPABASE_SECRET_KEY`)가 아니다.
- (선택) 다른 기기에서도 확인 링크가 동작하게 하려면 메일 템플릿의 링크를 `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`로 바꾼다. 바꾸지 않아도 같은 브라우저에서는 기본 방식(`?code=`)으로 동작한다.

## 5. 검증 기록

### 5-1. 실제로 실행한 것 (가짜 Supabase Auth 서버 기준)
샌드박스에서 실제 Supabase Auth에 로그인할 수 없어서, **문서로 이해한 동작을 흉내 낸 가짜 서버**를 만들어 운영 빌드(`next start`)를 대상으로 시험했다. 이 시험은 "우리 코드가 그 동작에 맞게 호출·처리하는지"를 보여 줄 뿐, **실제 Supabase의 동작을 증명하지 않는다.**

| 시험 | 결과 |
|---|---|
| `tsc --noEmit` | 통과 |
| `eslint .` | 경고·오류 없음 |
| `node --test scripts/auth-validation.test.mjs` (입력 검사 단위 시험) | 4개 중 4개 통과 |
| `next build` | 통과. 단, 샌드박스에서 Google Fonts를 받을 수 없어 **`app/layout.tsx`의 폰트 부분을 뺀 복사본**으로 빌드했다. 실제 `layout.tsx` 그대로의 빌드는 이 환경에서 못 했다 |
| 브라우저 시험 (Playwright, 가짜 Auth + 가짜 자료 서버) | 44개 중 44개 통과 |
| `node scripts/verify-auth.mjs` 비로그인 부분 | 6개 중 6개 통과 |

브라우저 시험이 다룬 것: 비로그인 첫 화면이 로그인 화면, 로그인 화면과 직접 접근한 계획 화면의 HTML에 자료 없음, 비로그인 API 17개 호출이 모두 401(DB에 닿지 않음), 엉터리 토큰·쿠키 401, 로그인 오류 문구 동일(없는 이메일·틀린 비밀번호·미확인·형식 오류), 입력 검사(이메일 형식, 짧은 비밀번호, 확인 불일치, 73바이트), 가입 안내 동일(중복 포함), 서버 로그에 비밀번호 없음, 확인 링크 흐름, 세션 쿠키 HttpOnly·SameSite=Lax, 로그인 후 내 계획+예시 계획 표시, 계획 생성 시 소유자 지정, 사용자 B의 목록·내보내기에 A의 계획 없음, 로그아웃 후 쿠키 삭제·API 401·쿠키 재사용 401, 폐기 후에도 JWT가 유효한 경우 무한 이동 없음.

### 5-2. 실행하지 않은 것 (직접 실행 필요)
- **실제 Supabase Auth로 하는 가입·이메일 확인·로그인·로그아웃.** 이메일 수신 포함.
- **로그아웃 후 같은 토큰이 실제로 거절되는가** (`verify-auth.mjs`의 (B) 부분). 공식 문서상 액세스 토큰은 `exp`까지 유효하므로, `getUser()`가 거절하는지는 이 시험으로만 확인된다. 거절하지 않으면 그 결과를 그대로 이 문서에 적어야 한다.
- 실제 Supabase의 로그인 오류 응답이 "없는 이메일"과 "틀린 비밀번호"에서 같은지 (`verify-auth.mjs`의 (B)).
- `verify-api.mjs`(기존 32개 확인)를 로그인한 시험 계정으로 다시 실행.
- 실제 `layout.tsx`로 하는 `next build`, Vercel 배포, 브라우저에서의 쿠키·네트워크 확인.

## 6. 아직 구현하지 않은 것 (카드 2 이후)
- id로 부르는 API(계획·할 일·실행)의 **소유자 확인**과 남의 자료 404.
- 예시 계획의 읽기 전용(쓰기 403)과 admin의 수정·삭제.
- 계정 삭제와 자료 삭제, 5일 사용 기록.
- `Idempotency-Key`의 사용자별 분리.
- 요청마다 `getUser()`로 Auth 서버에 묻는 비용(지연) 점검.
