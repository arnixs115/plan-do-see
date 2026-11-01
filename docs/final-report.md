# 과제 8 최종 제출 보고서 (초안) — 내 소개 페이지에 패스키 달기

- 서비스: Plan-Do-See Diary (계획 → 실행 → 돌아보기)
- 소스: https://github.com/arnixs115/plan-do-see
- 배포 주소: https://plan-do-see-silk.vercel.app (문서에 적힌 주소. **이 보고서를 쓰는 시점에 접속해 확인하지 못했다.** 제출 전에 직접 열어 확인한다)
- 이 보고서의 "검증"은 별도 표시가 없으면 **로컬 하네스**(진짜 Postgres + 가짜 Supabase Auth + 가상 인증기)에서 실행한 결과다. 실제 Supabase·Vercel·실제 패스키 제공자에서의 확인은 `docs/submission-evidence.md`의 "미검증" 항목이다.

## ① 무엇을 사용했는가?

| 구분 | 사용한 것 (저장소 `package.json` 기준) |
|---|---|
| 패스키 구현 방식 | **서버가 챌린지를 만들고 서버가 검증하는 WebAuthn 직접 연동.** 인증 서비스(Auth0 등)에 맡기지 않았다. 공개 키·credential ID는 우리 DB에 저장하고 개인 키는 사용자의 기기·패스키 제공자에 남는다 |
| WebAuthn 라이브러리 | `@simplewebauthn/server` 14.0.3 (서버: 옵션 생성·등록/인증 검증), `@simplewebauthn/browser` 14.0.0 (브라우저: `startRegistration`/`startAuthentication`) |
| 프레임워크 | Next.js 16.3.8 (App Router), React 19.2.8, TypeScript, Tailwind 4 |
| 인증·세션 | Supabase Auth(이메일+비밀번호, httpOnly 쿠키 세션) — `@supabase/supabase-js` 2.117.2, `@supabase/ssr` 0.12.7. 패스키 로그인은 서명 검증 뒤 **같은 Supabase 세션**을 발급한다 |
| DB | Supabase Postgres (표 `passkey_credentials`, `passkey_registration_challenges`, `passkey_login_challenges`, `private_items` 등, 함수는 마이그레이션 `db/migrations/`) |
| 배포 환경 | Vercel(서버리스) — 문서 기준. 이번 작업에서 배포를 실행하지 않았다 |

## ② 왜 선택했는가?

- **라이브러리 사용 vs 직접 구현**: 챌린지 확인, origin·RP ID 확인, 서명 검증, COSE 키 파싱은 틀리기 쉽고 틀리면 곧바로 보안 구멍이다. 검증된 라이브러리(SimpleWebAuthn)에 맡기고, 우리 코드는 "챌린지 보관·소비, 소유자 연결, 세션 발급"에 집중했다. 단점은 라이브러리 버전·동작에 의존한다는 점이다.
- **외부 인증 서비스 vs 직접 연동**: 서비스에 맡기면 개발 시간이 줄지만 기존 Supabase 사용자·세션 구조와 따로 놀게 된다. 직접 연동하면 코드는 늘지만 기존 계정·RLS·세션을 그대로 쓸 수 있어 "두 번째 세션 체계"가 생기지 않는다.
- **기존 프로젝트와의 호환성**: 패스키 검증이 끝나면 Supabase의 일회용 로그인 링크 값을 서버에서만 만들어 세션으로 바꾼다(`lib/auth/passkey-session.ts`). 그래서 기존 `requireUser`, 로그아웃, 만료·폐기가 그대로 동작한다.
- **서버리스 대응**: 챌린지는 서버 메모리가 아니라 DB에 저장하고, 소비는 `UPDATE … RETURNING` 한 문장(원자적)으로 한다. 요청이 다른 인스턴스로 가도 동작한다.
- **보안·시간 판단**: 비밀번호 로그인은 **복구 경로로 남겼다**(마지막 패스키를 지워도 계정에 들어올 수 있게). 대신 패스키 전용 화면이 아니다 — 아래 ④·한계 참고.

## ③ 소스의 어디를 수정했는가?

| 기능 | 코드 경로 | 주요 함수와 역할 |
|---|---|---|
| 패스키 등록 | `app/api/passkeys/register/options/route.ts`, `register/verify/route.ts`, `lib/passkeys/store.ts`, `app/account/passkey-section.tsx`, `db/migrations/20261030100000_add_passkeys.sql` | `requireUser`로 등록자 확인 → `createRegistrationChallenge`(챌린지 저장) → 브라우저 `startRegistration` → `consumeRegistrationChallenge`(원자적 소비) → `verifyRegistrationResponse` → `insertPasskey`(공개 키·credential ID 저장) |
| 패스키 로그인 | `app/api/passkeys/login/options/route.ts`, `login/verify/route.ts`, `lib/auth/passkey-session.ts`, `app/login/passkey-login-button.tsx`, `db/migrations/20261031120000_add_passkey_login.sql` | `createLoginChallenge` → `startAuthentication` → `consumeLoginChallenge` → `findCredentialById`(저장된 credential에서 사용자 결정) → `verifyAuthenticationResponse`(공개 키로 서명 검증) → `recordPasskeyAuthentication`(카운터가 올랐을 때만) → `issueSessionForUser`(세션 발급) |
| 로그아웃 | `app/api/auth/logout/route.ts`, `lib/auth/sign-out.ts`, `app/app-header.tsx`, `app/back-forward-guard.tsx`, `proxy.ts` | `signOutCurrentSession`(서버에서 세션 폐기 + `sb-*` 쿠키 삭제), 로그인 필요 화면 `no-store`, 뒤로 가기 방지 |
| 비공개 데이터 조회 | `app/api/private-items/route.ts`, `app/api/private-items/[item_id]/route.ts`, `app/private/page.tsx`, `lib/private/items.ts`, `lib/auth/require-user.ts`, `db/migrations/20261102100000_add_private_items.sql` | `requireUser`/`getCurrentUser`(세션→사용자), `listPrivateItems`·`getPrivateItem`(`user_id` 조건), `ensure_private_items`(계정별 가상 항목) |
| (추가) 패스키 관리 | `app/api/passkeys/route.ts`, `app/api/passkeys/[passkey_id]/route.ts`, `db/migrations/20261101100000_add_delete_passkey.sql` | 목록, `delete_passkey`(소유자 조건·마지막 패스키 409) |

## ④ 무엇을 직접 검증했는가?

정상 요청과 거부 요청의 비교 (로컬 하네스, 실제 HTTP 상태):

| 검증 | 정상 요청 | 거부 요청 | 비고 |
|---|---|---|---|
| 1. 비로그인 비공개 접근 | 로그인 세션으로 `GET /api/private-items` → **200**, 항목 3개 | 세션 없이 같은 요청 → **401** `{"error":"로그인이 필요합니다."}`. 항목 상세도 **401**. 엉터리 토큰·쿠키도 401 | 브라우저 쪽 거부 없음, 모두 서버가 거부 |
| 2. 다른 패스키/미등록 credential | 등록된 패스키의 서명 → `POST /api/passkeys/login/verify` **200**(세션 쿠키 발급) | 서버 DB에 없는 패스키(인증기에는 있음) → **401** `패스키로 로그인하지 못했습니다…`, 쿠키 없음. 서명 1바이트 변조 → **401**, 쿠키 없음. 다른 챌린지의 `challenge_id` → **401**, 존재하지 않는 `challenge_id` → **400** | 가상 인증기가 후보를 제공해 요청이 서버까지 갔다. 브라우저 WebAuthn이 거부해 서버 요청이 없던 경우는 **발생하지 않았다**(미재현) |
| 3. 이미 사용한 챌린지 재사용 | 최초 인증 → **200**, 챌린지 소비됨 | 같은 요청 재전송 → **400** `로그인 요청이 만료되었거나 이미 사용되었습니다…`, 쿠키 없음. 같은 요청 5개 동시 → 정확히 1개만 200(나머지 400). 만료된 챌린지 → **400** | |
| 4. 삭제된 패스키 | 남은 패스키 B로 로그인 → **200**, `/api/private-items` **200** | 삭제 전에 만든 A의 결과 → **401**. 삭제 뒤 인증기가 A를 후보로 내놓아 새로 만든 서명 → **401**, 새 세션 발급 없음 | 가상 인증기가 삭제된 A를 계속 제공해 서버가 거부했다. 실제 브라우저가 A를 후보에서 빼는지는 **미검증** |

추가로 확인한 것: 계정 A↔B 양방향 격리(`docs/account-isolation.md`) 61건 통과, 시험 전후 항목 수 A 3→3 / B 3→3(내용 해시 동일), 회귀 시험(카드 1~4) 아래 표.

### 카드 1~4 회귀 결과

| 카드 | 항목 | 상태 | 근거 |
|---|---|---|---|
| 1 | 공개 소개 페이지가 비로그인으로 표시 | 통과(로컬) | `verify-intro` 11/11, `/` 200 |
| 1 | 기존 소개 내용 유지 | 통과(로컬) | 소개 문구 21개 존재. 단, 소개 내용은 개인 소개가 아니라 **웹 서비스 소개**로 교체했다(사용자 결정) |
| 1 | 비공개 항목 3개 이상 | 통과(로컬) | 계정마다 3개 |
| 1 | 비로그인 비공개 API 401 | 통과(로컬) | 401 |
| 1 | HTML·공개 응답에 비공개 데이터 없음 | 통과(로컬) | `verify-private` 25/25(빌드 번들 18개 파일 포함) |
| 2 | 서버가 등록 챌린지 생성·보관 | 통과(로컬) | DB 보관, 5분 만료 |
| 2 | 연속 챌린지가 서로 다름 | 통과(로컬) | |
| 2 | 공개 키가 DB에 저장 | 통과(로컬) | |
| 2 | 개인 키가 서버로 전송되지 않음 | 통과(로컬) | 요청 본문 구조 확인(구조 근거. 인증기 내부는 볼 수 없음) |
| 2 | 등록 취소 시 불완전 credential 없음 | 통과(로컬) | **검증 요청이 서버에 도달하지 않게 막는 방식**으로 시험했다. 브라우저의 "취소" 버튼(NotAllowedError)을 직접 누른 것은 아님 |
| 2 | 패스키 이름·저장 위치 확인 | 부분 통과 | 이름·등록 일시·장치 유형(`singleDevice`/`multiDevice`)은 표시. **실제 제공자(Google Password Manager 등)는 서버가 알 수 없어 단정하지 않는다** |
| 3 | 매 로그인 새 챌린지 | 통과(로컬) | |
| 3 | 공개 키로 서명 검증 | 통과(로컬) | |
| 3 | 정상/잘못된 서명 구분 | 통과(로컬) | 200 / 401 |
| 3 | 챌린지 재사용 거부 | 통과(로컬) | 400 |
| 3 | 성공 시에만 세션 발급 | 통과(로컬) | 실패 요청은 쿠키 0개 |
| 3 | 로그아웃 후 기존 세션 접근 불가 | 통과(로컬) | 204 → 이후 401. 만료·폐기는 **가짜 Auth 서버**에서 시험. 실제 Supabase 동작은 미검증 |
| 3 | **비밀번호 입력란이 없는지** | **실패(요구와 다름)** | `/login`에는 이메일·비밀번호 폼이 **그대로 있고**(`app/login/login-form.tsx`) 그 아래에 「패스키로 로그인」 버튼이 있다. 비밀번호 로그인은 가입과 계정 복구에 쓰려고 의도적으로 남겼다. 제거하려면 가입·복구 방식을 따로 설계해야 한다 |
| 4 | 한 계정에 패스키 2개 | 통과(로컬) | |
| 4 | 목록에 이름·등록 일시 | 통과(로컬) | |
| 4 | 하나 삭제 후 남은 패스키로 로그인 | 통과(로컬) | |
| 4 | 삭제된 패스키로 로그인 불가 | 통과(로컬) | 401 |
| 4 | 0개일 때 동작 설명 | 통과(로컬) | 확인 없이 지우면 409(`last_passkey`), 확인 후 삭제 가능, 기존 세션 유지, 세션이 없으면 이메일·비밀번호 로그인 후 재등록 |
| 5 | A/B 각자 패스키로 로그인해 자기 항목만 조회 | 통과(로컬) | 브라우저(가상 인증기) 8/8 |
| 5 | 배포본 확인(공개 화면, Vercel 보호 해제 등) | 미검증 | `docs/submission-evidence.md` |

## ⑤ AI와 나의 판단

> 이 항목의 지시문이 "다음 세 가지를 각각 한 줄로 정리"에서 끝나 있어 **세 가지가 무엇인지 지시문에 적혀 있지 않았다.** 아래는 일반적으로 쓰는 세 칸(AI가 한 일 / 내가 정한 일 / AI 결과를 내가 고치게 한 일)으로 맞춘 초안이다. **"나의 판단"은 본인이 직접 쓰는 것이 맞으므로, 사실로 확인된 것만 적고 나머지는 비워 두었다.** 실제 지시문의 세 가지에 맞게 바꿔 쓰세요.

1. **AI가 한 일**: WebAuthn 등록·로그인·삭제 API와 DB 함수, 계정별 비공개 항목 조회 코드를 작성하고, 가상 인증기로 시험해 결과를 정리했다.
2. **내가 정한 일**: (직접 작성) — 대화 기록상 확인되는 결정: 소개 페이지를 "나를 소개"가 아니라 **웹 서비스 소개로 바꾸기**, 첫 화면은 공개 영역으로 하고 로그인 후 「내 계획 보기」로 가게 하기, 커밋·푸시는 내가 확인한 뒤 직접 하기.
3. **AI 결과를 내가 확인해 고치게 한 일**: 배포본에서 첫 화면이 로그인으로 이동하고 「내 계획 보기」가 404인 문제를 내가 발견해 AI가 수정 패치를 다시 만들었다(AI가 만든 첫 패치가 반영 파일을 빠뜨렸던 것). (직접 작성) — 그 밖에 직접 확인하며 판단한 것.

## 한계와 남은 문제 (제출 전에 알고 있어야 하는 것)

- **실제 환경 미검증**: 실제 Supabase Auth(세션 만료·폐기), Vercel 배포본, 실제 패스키 제공자·기기는 이 세션에서 시험하지 못했다.
- **비밀번호 입력란이 남아 있다**(위 회귀표 "실패").
- 계정 격리는 RLS가 아니라 **앱 코드의 소유자 조건**이 지킨다(서버가 service role 키 사용). 새 API에서 소유자 조건을 빼먹으면 격리가 깨진다 — 변이 시험으로 확인: 상세 조회에서 `user_id` 조건을 빼면 같은 시험이 A→B, B→A 양방향에서 실패한다.
- 비공개 항목은 가상 데이터이며, 첫 조회 때 계정 몫이 채워진다(읽기 요청이 DB에 쓰기를 한다. 멱등).
- 이메일 가입이 열려 있어 가입한 누구나 자기 비공개 영역을 가진다(남의 것은 못 봄).
- 패스키 삭제는 서버의 credential만 지운다. 기기·패스키 관리자에 저장된 패스키는 사용자가 직접 지워야 한다.
