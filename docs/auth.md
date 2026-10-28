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

### 5-3. 카드 2: 비밀번호를 어떻게 맡아 두는지

**결론부터:** 비밀번호 해싱은 우리 코드가 아니라 **Supabase Auth**가 한다. 우리는 해시 저장 구조를 만들지 않았고(`public` 스키마에 비밀번호·해시 열 없음), 비밀번호는 `app/auth/actions.ts` 한 곳에서만 읽어 `supabase.auth.signUp()` / `signInWithPassword()`에 넘기고 버린다.

| 항목 | 내용 | 근거 / 확인 수준 |
|---|---|---|
| 서비스 | Supabase Auth (GoTrue 기반), 저장 위치 `auth.users.encrypted_password` | 실제 DB에서 열 확인 (확인함) |
| 해싱 방식 | bcrypt (비용 10, 형식 `$2a$10$` + 22자 salt + 31자 해시 = 60자) | Supabase 공식 문서 "Password security"는 bcrypt 사용을 밝힌다 (문서 확인). 실제 저장값의 접두사가 `$2a$10$`(비용 10)임을 **확인함** (아래 "실제 Supabase 계정 두 개의 저장값 비교"). Auth 서버가 이 라이브러리를 쓴다는 점 자체는 2차 자료 |
| 라이브러리 버전 | 우리가 쓰는 클라이언트: `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.117.2 (`package-lock.json`) | 확인함. 이 둘은 비밀번호를 해싱하지 않고 서버로 보내기만 한다 |
| Auth 서버 버전 | **확인하지 못함** | 샌드박스에서 Supabase Auth에 접속 불가. DB의 `auth` 스키마 마이그레이션은 82개(최신 20260831180000)로 확인했으나 서버 버전은 아님 |
| 선택 이유 | 직접 구현하지 않고 검증된 서비스에 맡김: 해시 알고리즘·salt·비교 코드를 직접 짜면 실수 위험이 크고, 카드 1에서 이미 Supabase Auth를 선택했다. 무료 플랜에서도 동일하게 동작한다 | 설계 판단 |
| salt | bcrypt는 해시를 만들 때마다 **무작위 salt 16바이트**를 새로 뽑아 해시 문자열 안에 함께 저장한다. 그래서 같은 비밀번호도 계정마다 다른 해시가 나오고, 로그인 때는 저장된 해시 안의 salt로 다시 계산해 비교한다 | Go `x/crypto/bcrypt` 소스(`crypto/rand`로 salt 생성)와 bcrypt 형식 설명 (문서 확인). GoTrue가 정확히 이 구현을 쓴다는 점은 2차 자료 |
| 72바이트 | bcrypt는 비밀번호 앞 72바이트만 쓴다. 우리 입력 검사가 72바이트 초과를 거절한다 (`lib/auth/validation.ts`) | 확인함 (단위 시험) |

**API 역할은 해시를 읽을 수 없다.** 실제 DB에서 `anon`, `authenticated`, `service_role` 모두 `auth.users`에 SELECT 권한이 없음을 확인했다. 해시는 SQL Editor(postgres 권한)에서만 볼 수 있다. 점검 SQL은 `db/checks/password-storage.sql`이며, 해시·비밀번호 값은 출력하지 않고 true/false·개수·접두사(알고리즘·비용)만 낸다.

#### 실제로 실행한 것
| 시험 | 결과 |
|---|---|
| 실제 DB 구조: 비밀번호 관련 열 조회 (`db/checks/password-storage.sql` 1번) | `auth.users.encrypted_password` 하나뿐. `public`에는 없음 |
| 실제 DB: 점검 SQL 2·3번 실행 | 처음에는 `auth.users`가 0행이라 판정 못 함 → 시험 계정 두 개 가입 뒤 실행 (아래 표) |
| 코드 검토: 비밀번호가 읽히는 곳과 로그 | 읽는 곳은 `app/auth/actions.ts` 한 곳. `console.error`는 오류 객체만 찍고 입력값은 안 찍음 |
| `node --test scripts/check-password-leak.test.mjs` (노출 검사 도구 자체 시험) | 7개 중 7개 통과 (일부러 심은 가짜 비밀번호를 응답 본문·헤더·주소·쿠키·base64·로그에서 잡는지, 비슷한 문자열은 안 잡는지) |
| 노출 검사 (Playwright 운영 빌드 + **가짜** Auth 서버): 가입, 확인 불일치 가입, 없는 계정 로그인, 확인 링크, 로그아웃, 로그인 성공 | 요청 53개를 HAR로 기록. 요청 본문에만 4번 있고, 요청 주소·헤더·쿠키, 응답 헤더·쿠키·본문, 서버 로그, 화면 HTML, localStorage·sessionStorage·`document.cookie`, 브라우저 콘솔에서 **0건** |
| 같은 검사, Auth 서버가 꺼진 오류 경로 | 화면에 "인증 서버에 연결하지 못했습니다"만 표시. HAR·서버 로그에 0건 |

#### 실제 Supabase 계정 두 개의 저장값 비교 (실행함)
시험을 위해 Supabase의 **Confirm email을 임시로 껐다**(이메일 발송 한도에 막혀 확인 메일을 받을 수 없었음. 시험 뒤 다시 켜야 하며, 켠 시각은 아래 "되돌리기"에 적는다). 시험 계정 `a-test@example.com`, `b-test@example.com`을 시험용 비밀번호 하나로 가입했다. 같은 비밀번호를 썼다는 점은 시험한 사람의 진술이며, 이 점검은 비밀번호를 볼 수 없어 직접 확인하지 못한다. 실행한 SQL은 `db/checks/password-storage.sql` 3번과 같고, 해시와 비밀번호는 출력하지 않았다.

| 확인 | 결과 |
|---|---|
| 계정 수 (`found_accounts`) | 2 |
| 저장된 해시가 서로 다른가 (`distinct_hashes`) | 2 → **서로 다름** |
| salt 부분이 서로 다른가 (`distinct_salts`, 해시의 8~29번째 글자) | 2 → **서로 다름** |
| 알고리즘·비용 접두사 | 둘 다 `$2a$10$` (`distinct_prefixes`=1) |
| bcrypt 형식(`$2a$10$` + 53자)에 맞는가 | 둘 다 true, 길이 60 |
| 평문이 아닌가 | bcrypt 형식 정규식에 맞고 길이 60이므로 평문으로 볼 수 없다 |

해석: 같은 비밀번호에서 해시가 달라진 것은 계정마다 salt가 다르기 때문이라는 설명과 일치한다(해시 문자열 안의 salt 부분이 서로 다름). 두 계정이 정말 같은 비밀번호였는지는 이 점검으로 확인할 수 없다(진술에 의존).

#### 실행하지 않은 것 (직접 실행 필요)
- **실제 Supabase로 하는 노출 검사** — 위 노출 검사는 가짜 서버 기준이라 실제 Supabase 응답이 비밀번호를 되돌려 주지 않는다는 증명이 아니다. 실제 서비스로 가입·로그인하며 HAR와 서버 로그를 저장해 `TEST_PASSWORD='<시험 비밀번호>' node scripts/check-password-leak.mjs --har 기록.har --log dev-server.log`를 실행해야 한다.
- Vercel 런타임 로그, Supabase 대시보드의 Auth 로그에 비밀번호가 남는지.
- Supabase Auth 서버 버전.

#### 남은 위험
- 비밀번호는 로그인·가입 때 **HTTPS 요청 본문**으로 우리 서버(Server Action)를 거쳐 Supabase로 간다. 요청 본문에 있는 것은 정상이며, 우리 서버 프로세스 메모리에는 잠시 원문이 있다. 서버가 침해되면 그 순간의 원문은 노출될 수 있다.
- 비밀번호 정책은 8자 이상·72바이트 이하뿐이다. 유출된 비밀번호 목록 대조나 시도 횟수 제한은 이 단계에서 다루지 않았다(Supabase Auth의 기본 요청 제한에 의존).
- bcrypt는 "느린 해시"이지만 약한 비밀번호는 해시가 유출되면 추측될 수 있다. 해시가 안전한 것이 아니라 DB 접근을 막는 것이 먼저다.

### 5-4. 카드 3: 들어온 사람을 어떻게 기억하는지 (세션·토큰·로그아웃)

#### 구현 사실 (코드를 읽어 확인)
| 항목 | 내용 |
|---|---|
| 인증 정보의 종류 | Supabase 세션 = 액세스 토큰(JWT, `session_id` 포함) + 리프레시 토큰. 브라우저에는 `sb-…` 쿠키(HttpOnly, SameSite=Lax, 운영에서 Secure)로만 저장된다. 주소·`localStorage`에는 두지 않는다 |
| 요청마다 사용자 확인 | 모든 API 핸들러 17개가 `requireUser()`에서 `supabase.auth.getUser()`를 부른다. 이 호출은 Auth 서버에 직접 물어서, 서명이 맞아도 폐기된 세션이면 거절된다. 페이지는 `getCurrentUser()`(같은 `getUser()`) |
| `proxy.ts` | `getClaims()`로 서명·만료만 본다(이동 안내용). 폐기된 세션의 토큰도 만료 전에는 통과할 수 있으므로 자료를 지키는 검사로 쓰지 않는다 |
| 로그아웃 | Server Action `logout` → `signOut({ scope: "local" })`(이 기기의 세션만 서버에서 폐기) → `sb-` 쿠키 삭제. 서버 폐기가 실패해도 쿠키는 지운다. 이때 서버의 세션이 남을 수 있다 |
| 만료 정책 (공식 문서) | 액세스 토큰은 기본 1시간 고정 만료, 리프레시 토큰은 만료되지 않지만 1회용(교환하면 새 쌍이 나옴). 세션은 기본적으로 로그아웃 전까지 이어진다. **고정 만료(Time-box)·비활동 만료는 Pro 전용**이라 Free에서는 쓸 수 없다 |
| 비밀번호 변경 | **구현하지 않았다.** 그러므로 "변경 후 기존 세션 무효화"는 시험할 수 없고, 시험했다고 적지 않는다. 문서상 Supabase는 비밀번호 변경 시 세션을 종료할 수 있다고 하지만 우리 앱에는 그 경로가 없다 |
| 비밀키 위치 | `SUPABASE_SECRET_KEY`는 `lib/supabase-server.ts`에서만 읽는다(`NEXT_PUBLIC_` 아님). 클라이언트 컴포넌트는 Supabase를 직접 부르지 않는다. 브라우저용 공개 키만 `NEXT_PUBLIC_`으로 쓴다 |

#### 비밀값 노출 검사 (실행함. 값은 출력하지 않았다)
| 확인 | 결과 |
|---|---|
| Git 추적 파일 중 `.env*` | `.env.example`만 추적됨. `.env*`는 `.gitignore`에 있음 |
| Git 전체 이력에서 `sb_secret_…`, JWT 형태 문자열, `SUPABASE_SECRET_KEY=<값>` | 0건 |
| Git 이력의 `service_role` 문자열 | 26줄, 모두 `db/migrations/*.sql`, `db/README.md`, `README.md`의 권한 설명 |
| 시험용 운영 빌드의 클라이언트 번들(`.next/static`) | 비밀키 이름·값·`service_role` 없음 (폰트를 뺀 복사본 빌드 기준) |
| `public/` | 기본 SVG 5개뿐 |
| **실제 Vercel 배포 번들, Vercel 환경변수 설정** | **확인하지 못함** |

#### 세션·토큰 시험: `scripts/verify-session.mjs`
- 실제 Supabase 계정으로 A(로그인 성공 요청) · B(같은 요청이 로그아웃 뒤 401, Auth 서버에 직접 물어도 거절, 리프레시 토큰 교환 거절) · C(발급·만료 시각, 서명이 틀린 토큰 거절) · E(둘째 세션은 계속 유효)를 확인한다. `--wait-expiry`를 주면 토큰 만료까지 기다린 뒤 같은 토큰이 401인지 확인한다. 토큰·비밀번호는 출력하지 않는다.
- **가짜 Supabase Auth 서버 기준으로 스크립트 자체를 시험했다**: 14개 중 14개 통과, 가짜 서버의 토큰 유효 시간을 12초로 줄여 `--wait-expiry`까지 17개 중 17개 통과. 이는 스크립트와 우리 코드의 동작 확인일 뿐이며, **실제 Supabase의 동작을 증명하지 않는다.** 단위 시험 `scripts/verify-session.test.mjs` 3개 통과.

#### 실제 Supabase로 실행한 결과 (2026-10-28, 시험 계정 `a-test@example.com`, 만료 시험 제외)
`node scripts/verify-session.mjs`를 실제 Supabase와 연결된 개발 서버에 실행했다. **14개 중 14개 통과, 실패 0.** 토큰·비밀번호는 출력되지 않았다.

| 확인 | 관찰한 결과 |
|---|---|
| 액세스 토큰 | JWT, 서명 방식 ES256, `session_id` 포함. 발급 00:41:15Z, 만료 01:41:15Z, **유효 시간 3600초**(응답의 `expires_in`도 3600). 고정 만료 시각(`exp`)이 있음 |
| 리프레시 토큰 | 따로 발급됨 |
| A. 로그인 상태의 성공 요청 | `GET /api/plans` (Authorization: Bearer ****) → **200**, 계획 4개. 요청 주소에 토큰 없음, 응답 본문에 토큰이 되돌아오지 않음 |
| B. 로그아웃 후 같은 요청 | `POST /auth/v1/logout?scope=local` 성공 뒤, **같은 메서드·같은 주소·같은 토큰**으로 `GET /api/plans` → **401** "로그인이 필요합니다." 두 요청의 차이는 그 사이의 로그아웃뿐 |
| B. Auth 서버에 직접 확인 | `GET /auth/v1/user` (폐기된 토큰) → **403 `session_not_found`**. 폐기가 서버(Auth)에서 일어났음을 확인 (쿠키 삭제만으로 끝난 것이 아님) |
| B. 리프레시 토큰 | 로그아웃한 세션의 리프레시 토큰 교환 → **400 `refresh_token_not_found`** |
| C. 서명이 틀린 토큰 | 본문(`exp`)을 바꾼 토큰 → **401** |
| E. 로그아웃 범위 | 같은 계정의 둘째 세션은 첫째 세션 로그아웃(scope=local) 뒤에도 **계속 200** → 로그아웃은 현재 세션만 폐기 |

이 결과로 "폐기된 세션의 토큰이 만료 전에도 우리 API에서 거절된다"는 점이 실제 Supabase에서 확인되었다(`getUser()`가 Auth 서버에 묻기 때문).

#### 실행하지 않은 것 (직접 실행 필요)
- **실제 만료 거절** (`--wait-expiry`, 약 1시간). 이 실행에서는 건너뛰었으므로 **확인하지 않았다.** (만료 정책 자체는 토큰의 `exp`와 공식 문서로 확인했다.)
- **브라우저 화면의 로그아웃 버튼 → 이전 쿠키 재사용 거절**(Server Action 경로)과 **실제 쿠키 속성**(DevTools → Application → Cookies에서 HttpOnly·SameSite·Secure 확인, 배포 주소 기준).
- 대시보드의 JWT 만료 시간·세션 설정 값. (토큰의 `exp`로 실제 유효 시간 3600초는 확인했지만, 대시보드 설정 화면의 값은 열어 보지 않았다.)

#### 남은 위험
- 폐기된 세션의 액세스 토큰은 서명 검증만 하는 곳(`proxy.ts`의 `getClaims()`)에서는 만료(최대 1시간)까지 유효해 보인다. API와 페이지는 `getUser()`로 막는다. 서버 폐기가 즉시 반영된다는 보장은 위 실제 실행 결과에만 근거한다.
- 로그아웃은 현재 기기 세션만 폐기한다(`scope: "local"`). 다른 기기의 세션은 남는다. 비밀번호 변경·전체 기기 로그아웃 기능이 없어서, 계정이 탈취돼도 다른 세션을 끊을 방법이 앱 안에 없다.
- Free 플랜에서는 세션의 고정 만료·비활동 만료를 설정할 수 없다. 리프레시 토큰이 유출되면 세션이 로그아웃 전까지 이어질 수 있다.

### 5-5. 카드 4: 남의 자료가 안 열린다

#### 설계와 한계
- 서버는 비밀 키로 DB에 접근하므로 **RLS는 우리 서버 경로에 적용되지 않는다.** 실제 DB에서 6개 테이블 모두 RLS가 켜져 있고 정책은 0개이며, `anon`·`authenticated`는 테이블을 읽을 수 없다(공개 키가 유출될 때의 방어). 그러나 서버 코드가 확인하지 않으면 아무도 막지 않으므로, **소유권은 서버 코드(아래 소스 위치)가 유일하게 막는다.** RLS가 켜져 있다는 사실을 안전의 근거로 쓰지 않는다.
- 소유자는 `plans.user_id`뿐이다. 할 일은 `todos.plan_id`, 실행은 `executions.todo_id → todos.plan_id`로 계획을 찾아 계획의 소유자를 본다.
- 규칙(`lib/auth/access-rules.ts`): 내 계획은 읽기·쓰기 허용 / 예시 계획은 읽기는 모두, 쓰기는 `admins` 표의 사용자만, 그 밖에는 403 / **남의 계획은 읽기·쓰기 모두 404**(없는 자료와 같은 응답이라 존재 여부를 알려 주지 않음). 소유자가 없는 일반 계획도 404.
- 수정 전에는 `id`로 부르는 API(계획·할 일·실행 단건, 하위 목록, 요약, 내보내기)에 소유자 확인이 없었다. 수정 전 빌드로 같은 시험을 돌려 **재현했다**(가짜 서버 기준 73개 중 36개 통과, 37개 실패: 남의 자료의 읽기·수정·삭제·실행 조작이 모두 성공, 예시 계획도 누구나 쓰기 가능).

#### 소스 위치
| 역할 | 위치 |
|---|---|
| 접근 규칙(순수 함수) | `lib/auth/access-rules.ts` `decideAccess` |
| 소유권 확인(계획·할 일·실행) | `lib/auth/ownership.ts` `authorizePlan`, `authorizeTodo`, `authorizeExecution` |
| 소유자 조건이 걸린 DB 쿼리 | `ownership.ts`의 `plans`·`todos`·`executions`·`admins` 조회(`id`로 소유 계획을 찾아 비교). 목록은 `app/api/plans/route.ts`의 `.or("user_id.eq.<로그인 사용자>,is_example.eq.true")`, 생성은 같은 파일의 `.insert({ ...values, user_id: <로그인 사용자> })` |
| 호출하는 API (`requireUser()` 바로 뒤) | `app/api/plans/[plan_id]/route.ts`(GET·PATCH), `.../todos/route.ts`(GET·POST), `.../summary/route.ts`, `.../export/route.ts`, `app/api/todos/[todo_id]/route.ts`(GET·PATCH·DELETE), `.../executions/route.ts`(POST), `app/api/executions/[execution_id]/route.ts`(GET), `.../pause·resume·end/route.ts` |
| 소유자·예시·admin 컬럼과 표 | `db/migrations/20261022060000_add_plan_owner_and_admins.sql`, `20261022060100_convert_legacy_plans_to_examples.sql` (RLS 정책은 없음) |
| admin 등록 | `db/manual/add-admin.sql` (손으로 실행) |
| 시험 | `scripts/verify-access.mjs`(실제 서비스 대상), `scripts/access-rules.test.mjs`(규칙 단위 시험, 4개) |

#### 실행한 시험 (가짜 Supabase 서버 기준)
`scripts/verify-access.mjs`를 가짜 Auth·자료 서버와 운영 빌드(`next start`)로 실행했다. **실제 Supabase 증명이 아니다.**

| 시험 | 결과 |
|---|---|
| 수정 전 빌드(라우트 10개 파일만 HEAD 버전으로 되돌려 빌드) | 73개 중 36개 통과, 37개 실패 (취약점 재현) |
| 수정 후 빌드 | 73개 중 73개 통과 |
| 단위 시험 (`node --test scripts/*.test.mjs`) | 18개 중 18개 통과 |
| 카드 1 브라우저 시험(`ui-auth-test.cjs`, 수정 후 빌드) | 통과 |
| `tsc --noEmit`, `eslint` | 오류·경고 없음 |

#### 실제 Supabase로 실행한 결과 (2026-10-28)
`node scripts/verify-access.mjs`를 실제 Supabase와 연결된 개발 서버(`npm run dev`)에 대해 실행했다. 시험 계정 A=`a-test@example.com`, B=`b-test@example.com`, admin=`admin-test@example.com`(`admins` 표에 등록, 등록 사실을 DB에서 확인함). 비밀번호는 이 문서에 적지 않았다. 시험 중 Supabase의 **Confirm email은 꺼져 있었다**(5-3절 참고).

**결과: 73개 중 73개 통과, 실패 0.**

| 구분 | 요청과 관찰한 응답 |
|---|---|
| 시험 자료 | A: 계획 2개(`[ACCESS-TEST-A]`), 할 일 4개, 실행 1개 / B: 계획 2개(`[ACCESS-TEST-B]`), 할 일 4개, 실행 1개. 모두 소유자가 본인으로 생성됨(201) |
| A→B 읽기 6종 | `GET /api/plans/{B계획}`, `…/todos`, `…/summary`, `…/export`, `GET /api/todos/{B할일}`, `GET /api/executions/{B실행}` → 모두 **404** |
| A→B 수정 6종 | `PATCH /api/plans/{B계획}`, `PATCH /api/todos/{B할일}`, `POST …/todos`, `POST /api/todos/{B할일}/executions`, `POST /api/executions/{B실행}/pause`, `…/end` → 모두 **404** |
| A→B 삭제 | `DELETE /api/todos/{B할일}` → **404** |
| B→A | 위 13개 요청을 방향만 바꿔 실행 → 모두 **404** |
| 사용자 ID 위조 | `POST /api/plans`에 본문 `user_id=B, is_example=true` → 201이지만 소유자=A, 예시 아님. `PATCH` 본문에 `user_id=B` → 소유자 그대로. `?user_id=B`, `?owner=B&userId=B`, 헤더 `X-User-Id`, `X-Owner-Id` → A의 목록에 B의 자료 0개 |
| 목록 격리 | A의 목록 4개(A 계획 3개 + 공개 예시 1개), B의 목록 3개(B 계획 2개 + 예시 1개), 상대 소유 계획 0개. A의 CSV 내보내기에 B의 제목 없음 |
| 비로그인 | `GET /api/plans`, `GET·PATCH /api/plans/{id}`, `GET·DELETE /api/todos/{id}` → 모두 **401** |
| 예시 계획 | A가 읽기 200. A의 `PATCH`, `POST …/todos`, `DELETE …/todos/{id}` → 모두 **403**("예시 자료는 읽기만 할 수 있습니다."). admin이 예시 계획에 할 일 추가 201, 삭제 204 |
| 거절 전후 무결성 | B의 자료: 계획 2→2, 할 일 4→4, ID·제목·상태·`updated_at`·`deleted_at` 동일, 새 할 일 없음, 실행 진행 중. A의 자료: 계획 2→3(A가 직접 만든 위조 시도 계획 1개), 할 일 4→4, 나머지 동일 |

**스크립트와 별개로 DB를 직접 조회해서 확인했다**(서비스 키를 쓰지 않고 SQL Editor 권한의 읽기 전용 조회): 시험 뒤 DB의 계획은 `[ACCESS-TEST-A]` 3개(소유자 A), `[ACCESS-TEST-B]` 2개(소유자 B)와 기존 예시 1개. 각 계획의 할 일 수가 스크립트 기록과 같고(계획 1·2 모두 2개), 제목에 `INJECT`가 든 할 일이 0개이며, A·B의 실행은 구간 1개씩이고 열린 구간이 없다(스크립트가 마지막에 각자 자기 실행을 종료하는 정리 단계를 거쳤기 때문). 예시 계획의 admin 시험 할 일은 삭제 표시(`deleted_at`) 상태다.

**관찰한 거절 상태는 404(남의 자료)·403(예시 쓰기)·401(비로그인)뿐이다.** 문서에서 정한 응답 계약과 같다.

#### 실행하지 않은 것
- 실제 DB에서 동시 요청(검사와 실행 사이의 경쟁 조건)은 시험하지 않았다.
- 계획 삭제 API가 없어 계획 삭제 거절은 시험할 수 없다. 삭제 거절은 `DELETE /api/todos/{id}`로 확인했다.
- 화면(브라우저)에서의 접근 시도는 이 시험에 포함되지 않았다. 시험은 API 직접 호출이다.

#### 남은 위험
- 소유자 확인과 실제 쓰기가 **서로 다른 쿼리**다. `plans.user_id`는 API로 바꿀 수 없어서 실제 위험은 낮지만, DB 함수에 소유자를 인자로 넘기는 방식보다는 약하다.
- 자료 한 건에 DB 조회가 1~3번 더 붙는다(할 일 1번, 실행 2번, 계획 1번, 예시 쓰기에서 admin 1번 추가).
- 실행 시작의 `Idempotency-Key`는 전역이다. 다른 사람이 쓴 키를 보내면 409로 "이미 쓰인 키"임이 드러난다(자료 내용은 새지 않음).
- 계획 삭제 API가 없어서 계획의 삭제 거절은 시험할 수 없다(할 일 삭제로 대신 확인). 계정 삭제는 카드 5에서 추가했다(`docs/assignment-7.md`).

## 6. 아직 구현하지 않은 것 (카드 2 이후)
- (카드 4에서 구현함: id로 부르는 API의 소유자 확인과 남의 자료 404, 예시 계획의 읽기 전용(쓰기 403)과 admin 쓰기. 실제 Supabase 시험은 5-5절 참고)
- (카드 5에서 구현함: 계정 삭제. 검증 결과와 5일 사용 기록 상태는 `docs/assignment-7.md`)
- `Idempotency-Key`의 사용자별 분리.
- 요청마다 `getUser()`로 Auth 서버에 묻는 비용(지연) 점검.
