# 과제 7 제출 설명서: 플랜두씨 다이어리 2 — 인증을 붙이고 어떻게 붙였는지 설명하기

> 이 문서는 **확인한 것**과 **확인하지 못한 것**을 구분해 적는다. 표시는 `확인함`(실제 Supabase 또는 DB로 확인), `가짜 서버 기준`(우리 코드가 문서로 이해한 동작에 맞게 호출·처리하는지만 본 것, 실제 Supabase 증명 아님), `미검증`, `미구현`, `실패`다.
> 인증 구조의 자세한 설명과 카드별 검증 기록은 [`docs/auth.md`](auth.md)에 있다. 비밀번호·토큰·비밀 키는 이 문서에 없다.

## 제출 URL

| 항목 | 값 |
|---|---|
| 결과 URL | `https://plan-do-see-silk.vercel.app` — 로그아웃 상태 첫 화면, 시크릿 창에서의 자료 노출 여부는 **아직 배포본에서 확인하지 못했다** (아래 "배포 확인" 참고) |
| 소스 URL | `https://github.com/arnixs115/plan-do-see` |
| 과제 6 최종 커밋 ID | `f6b6a7740e5dde6ce86960eed6c13ba522e5618f` (`origin/main` `236f159`의 조상임을 `git merge-base --is-ancestor`로 확인함) |
| 과제 7 제출 커밋 ID | **미정.** 문서 안에 자기 커밋 ID를 적을 수 없으므로(적으면 ID가 바뀜), 제출 직전에 `git rev-parse HEAD`로 얻은 값을 제출 양식에 입력한다. 이 문서에는 카드 5 직전 코드 기준 커밋 `236f159`만 적는다 |

## ① 무엇을 구현했는가

- **이메일·비밀번호 가입과 로그인, 로그아웃** (Supabase Auth, 서버 쿠키 세션). 로그인하지 않으면 모든 API가 401, 화면은 로그인으로 이동.
- **내 자료만 열림:** 계획·할 일·실행의 소유자 확인. 남의 자료는 404, 예시 계획은 읽기만(쓰기는 `admins`만), 비로그인은 401.
- **계정 삭제** (카드 5에서 추가): `DELETE /api/account` + `/account` 화면. 본인 이메일을 다시 적어야 삭제되며, 삭제 대상은 항상 로그인한 본인이다.
- **통계(결과 요약)와 CSV 내보내기:** 본인 자료와 예시 계획만 나온다.
- **검증 도구:** `scripts/verify-*.mjs`, 점검 SQL(`db/checks/`).

## ② 왜 그렇게 했는가

| 결정 | 이유 |
|---|---|
| 인증은 직접 만들지 않고 Supabase Auth | 해시·salt·세션 토큰 코드를 직접 짜면 실수 위험이 큼. Free 플랜에서도 동작 |
| 서버는 비밀 키로 DB 접근, 소유권은 서버 코드가 막음 (RLS 정책 없음) | 사용자가 정한 방식(A안). 대신 **코드 한 곳이 유일한 방어선**이라서 검증 시험을 따로 만들었다 |
| 남의 자료는 403이 아니라 404 | 존재 여부를 알려 주지 않으려고 |
| 요청마다 `getUser()`(Auth 서버 확인) | 폐기된 세션의 토큰이 만료 전에도 거절되게 하려고 (실제 Supabase로 확인함, `docs/auth.md` 5-4) |
| 계정 삭제는 이메일 재입력 + 본인만 | 실수와 남의 계정 삭제를 막으려고. 사용자 ID를 요청으로 받지 않는다 |
| 삭제는 DB의 `on delete cascade`에 맡김 | 계획·할 일·실행·구간·수정 이력·admin이 사용자에 외래 키로 이어져 있어 한 번에 지워짐 |

## ③ 어느 파일을 어떻게 수정했는가

| 파일 | 변경 | 이유 | API·DB 정책 | 검증 |
|---|---|---|---|---|
| `app/auth/actions.ts`, `lib/auth/*`, `proxy.ts` | 가입·로그인·로그아웃, 세션 쿠키, 요청 확인 | 카드 1~3 | 쿠키 HttpOnly·SameSite=Lax, 운영 Secure. 로그아웃 `scope: local` | `docs/auth.md` 5-3, 5-4 (실제 Supabase로 14/14, 만료 시험 제외) |
| `lib/auth/access-rules.ts`, `lib/auth/ownership.ts` | 접근 규칙(순수 함수)과 계획·할 일·실행 소유권 확인 | 카드 4 | 내 것 허용 / 예시는 admin만 쓰기(403) / 남의 것 404 | 실제 Supabase로 73/73 (`docs/auth.md` 5-5) |
| `app/api/**/route.ts` 10개 | `requireUser()` 바로 뒤에 `authorizePlan/Todo/Execution` 호출 | 카드 4 (수정 전에는 `id`로 부르는 API에 소유자 확인이 없었고, 수정 전 빌드로 재현함: 가짜 서버 기준 73개 중 37개 실패) | 같음 | 같음 |
| `db/migrations/20261022060000_*`, `…060100_*`, `db/manual/add-admin.sql` | `plans.user_id`, `is_example`, `admins` 표 | 카드 4 | RLS 정책은 만들지 않음 (6개 표 RLS 켜짐·정책 0개, anon·authenticated 접근 없음) | DB 조회로 확인 |
| `lib/auth/account-deletion.ts`, `app/api/account/route.ts` | `DELETE /api/account`: 이메일 확인 → `auth.admin.deleteUser(본인 id)` → 204, `sb-` 쿠키 삭제 | 카드 5 | 요청에 사용자 ID 없음. 이메일 불일치 400 | 단위 시험 3/3, 실제 Supabase로 19/19 + DB 대조 (아래 ④) |
| `app/account/page.tsx`, `app/account/delete-account-form.tsx`, `app/app-header.tsx` | 계정 삭제 화면과 헤더 "계정" 링크 | 카드 5 | — | 화면은 직접 열어 확인하지 **않았다** (미검증) |
| `scripts/verify-account-deletion.mjs`, `scripts/verify-stats-export.mjs`, `db/checks/usage-5days.sql` | 실제 서비스 검증 도구 | 카드 5 | 읽기·시험 계정 전용. 삭제 스크립트는 `--delete-test-account` 필요 | 아래 ④·⑤ |

## 통계 정확도 검증 (카드 5, 실제 Supabase, 2026-10-28)

**지표 정의(코드 기준):** 완료율 = 삭제되지 않은 할 일 중 완료 수 ÷ 삭제 제외 전체, 소수 넷째 자리 반올림(할 일 0개면 null). 작업 시간 = 실행 구간(`execution_segments`) 길이의 합(일시정지 제외, 진행 중 구간은 지금까지). 소프트 삭제된 할 일과 그 실행은 제외. 평균·기간별·시간대 통계는 **구현하지 않았다**(검증 대상 아님).

시험 자료(a-test, 제목 `[STATS-TEST]`): 계획 예상 100분, 할 일 4개(T1 10분 완료 / T2 20분 진행 중 일시정지 / T3 30분 실행 후 삭제 / T4 40분 실행 없음). `node scripts/verify-stats-export.mjs`: **39개 중 39개 통과.**

| 지표 | 직접 계산 | API 값 | DB 직접 조회 | 일치 | 근거 |
|---|---|---|---|---|---|
| 할 일 수(삭제 제외) | 3 | 3 | 3 (삭제 1) | 일치 | T1·T2·T4 |
| 완료 / 진행 중 / 할 일 | 1/1/1 | 1/1/1 | 1/1/1 | 일치 | 상태 규칙 |
| 완료율 | 0.3333 | 0.3333 | 함수 호출 0.3333 | 일치 | 1÷3 |
| 할 일 예상 합계(분) | 70 | 70 | 70 | 일치 | 10+20+40 (T3 제외) |
| 계획 예상(분) | 100 | 100 | 100 | 일치 | — |
| 실행 횟수 / 끝나지 않은 실행 | 2 / 1 | 2 / 1 | 2 / 1 | 일치 | T2는 일시정지(종료 안 함) |
| 작업 시간(초) | 11.5 | 11 | 구간 합 11.52 | **0.52초 오차** | 아래 |

**알려진 한계:** 계획 합계는 구간의 정확한 합이 아니라 *할 일별로 반올림한 값의 합*(8+3=11)이다. 한 번만 반올림하면 12초다. 할 일이 많을수록 오차가 최대 할 일당 0.5초까지 쌓인다. 고치려면 DB 함수 변경이 필요해 하지 않았다. **검증하지 못한 것:** 진행 중(열린) 구간의 시간(시험 시점에 열린 구간이 없었음), 큰 자료.

## 내보내기 검증 (카드 5, 실제 Supabase)

| 확인 | 결과 |
|---|---|
| 비로그인 `GET /api/export`, `GET /api/plans/{id}/export` | 401 |
| A의 todos CSV | 6행(DB 기대값 6행), 고유 계획 2(A에게 보이는 내 계획 + 예시 = DB 2). 누락·중복 없음 |
| A의 executions CSV | 6행(DB 기대값 6행) |
| B의 비공개 계획 | A의 CSV에 ID·제목 없음. B의 CSV에도 A의 시험 계획 없음 |
| `?user_id=B`, `?owner_id=B` | 무시됨 (파라미터 없는 요청과 결과 같음) |
| A가 B의 계획 export | 404 |
| 형식 | UTF-8 BOM, CRLF, `text/csv`, 파일 이름 `plan-do-see-all-plans-todos-YYYY-MM-DD.csv`, 삭제된 할 일은 `todo_deleted_at`이 채워진 행으로 포함 |
| 알 수 없는 `type` | 400 |

## 계정 삭제 검증 (카드 5, 실제 Supabase, 삭제 전용 시험 계정)

`node scripts/verify-account-deletion.mjs … --delete-test-account`: **19개 중 19개 통과.** 삭제 계정 D(삭제 전용 시험 계정)와 남는 계정 B.

| 계정 | 요청 | 응답 |
|---|---|---|
| 비로그인 | `DELETE /api/account` | 401 |
| D | `DELETE /api/account` 본문 `{}` | 400 |
| D | 틀린 이메일 | 400 |
| B | D의 이메일을 적음 / 본문·쿼리에 D의 `user_id` | 400 (삭제 대상은 항상 로그인한 본인) |
| D | 본인 이메일(대소문자 무시) | **204** |
| D(삭제 후) | 삭제 전 받은 토큰으로 `GET /api/plans` | 401 |
| D(삭제 후) | Auth 서버 `GET /auth/v1/user`, 비밀번호 재로그인, 리프레시 토큰 | 거절(403 `user_not_found`, 400 계열) |

**DB 직접 조회(읽기 전용):** `auth.users`에 D 없음(전체 3명: a-test, b-test, admin-test). D의 계획·할 일·실행·구간·수정 이력 모두 0행. 소유자 없는 `auth.sessions` 0, 주인 없는 계획 0, 주인 없는 `admins` 0. B의 계획·할 일·실행·구간 각 1행 그대로, 예시 계획 1개 그대로. 거절 요청 뒤에도 두 계정은 정상 동작(200).

**한계:** 삭제 직전에 이미 서버가 받은 요청은 막지 못한다. 삭제 화면(`/account`)을 브라우저로 열어 확인하지 못했다(API만 시험).

## 5일 사용 기록 (진행 중 — 아직 충족하지 않음)

- 계정: `a-test@example.com`(시험 계정). 기록 계획 제목은 `[TEST]`로 시작해 `[STATS-TEST]`·`[ACCOUNT-DEL-TEST]` 시험 자료와 구분한다.
- "계획 규칙 변경"은 **계획 수정(우선순위·성공 기준·목표일·예상 시간)** 으로 정했고, 수정하면 직전 값이 `plan_revisions.snapshot`에 남는다. 2일째와 3일째 사이에 한 번 수정한다.
- 날짜·시각은 서버가 기록한 값이며 SQL로 고치거나 소급해서 만들지 않는다. 확인은 `db/checks/usage-5days.sql`(읽기 전용)로 한다.
- **현재 상태: 2026-10-28 기준 서울 날짜 1일(시험 자료 포함 확인) — 5일 미충족.** 제출 시점에 실제로 채운 날짜만 아래 표에 적고, 5일에 못 미치면 "미충족"으로 둔다.

| 기록 날짜(서울) | 기록 식별자(앞 8자리) | 소유자(마스킹) | 규칙 변경(시각 / 전 → 후) | 전후 구분 | 근거 |
|---|---|---|---|---|---|
| (제출 전에 `usage-5days.sql` 결과로 채운다) | | | | | |

## ④ 차단된 요청의 증거

관찰한 거절 상태는 404·403·401·400이다. **상태 코드만으로 "완벽히 막았다"고 결론내지 않았고**, 각 시험에서 거절 전후의 DB·API 자료가 그대로인지 함께 대조했다.

| 목적 | 요청(메서드 + 경로) | 계정 | 상태 | 본문 | 전/후 자료 상태 | 판단 |
|---|---|---|---|---|---|---|
| 남의 자료 읽기 | `GET /api/plans/{B계획}`, `…/todos`, `…/summary`, `…/export`, `GET /api/todos/{B할일}`, `GET /api/executions/{B실행}` | A (B 자료) | 404 | 없는 자료와 같은 문구 | B 자료 변화 없음 | 차단됨 |
| 남의 자료 수정·삭제·실행 조작 | `PATCH /api/plans/{B}`, `PATCH /api/todos/{B}`, `POST …/todos`, `POST /api/todos/{B}/executions`, `POST /api/executions/{B}/pause·end`, `DELETE /api/todos/{B}` | A | 404 | 같음 | B 계획 2→2, 할 일 4→4, `updated_at`·`deleted_at` 동일, 실행 진행 중 그대로 | 차단됨. 반대 방향(B→A)도 같음 |
| 소유자 위조 | `POST /api/plans` 본문 `user_id=B, is_example=true` | A | 201 | — | 소유자=A, 예시 아님(요청 값 무시) | 위조 무시됨 |
| 예시 계획 쓰기 | `PATCH /api/plans/{예시}`, `POST …/todos`, `DELETE …/todos/{id}` | A | 403 | "예시 자료는 읽기만 할 수 있습니다." | 예시 변화 없음 | 차단됨. admin은 허용(201/204) |
| 비로그인 | `GET /api/plans`, `GET·PATCH /api/plans/{id}`, `GET·DELETE /api/todos/{id}` | 없음 | 401 | "로그인이 필요합니다." | — | 차단됨 |
| 로그아웃한 토큰 | 같은 토큰으로 `GET /api/plans` | A | 200 → 로그아웃 → 401 | — | Auth 서버도 403 `session_not_found` | 서버에서 폐기됨 |
| 타인 계정 삭제 | `DELETE /api/account` (D의 이메일·`user_id`를 넣음) | B | 400 | 이메일 불일치 | D의 계정·자료 그대로 | 차단됨 |
| 내보내기 우회 | `GET /api/export?user_id=B` | A | 200 | A의 CSV | B 자료 0행 | 파라미터 무시 |

출처: `docs/auth.md` 5-4, 5-5, 위 계정 삭제·내보내기 절. 모두 **실제 Supabase**와 연결된 개발 서버에서 2026-10-28에 실행했다.

## ⑤ AI와 사용자 판단 구분

| 판단·작업 | 누가 |
|---|---|
| 소유권을 서버 코드로 막는 A안, 남의 자료 404, 예시 계획 읽기 전용(admin만 쓰기) | **사용자가 승인** (AI가 안을 제시) |
| 계정 삭제 구현 범위(API + 작은 확인 화면), "계획 규칙 변경" 해석, 5일 기록 계정(a-test) | **사용자가 결정** |
| 실제 Supabase에서 시험 실행, 계정 생성, Confirm email 임시 해제, 커밋·푸시 | **사용자** |
| 코드·시험 스크립트·SQL·문서 작성, 가짜 서버 시험, 읽기 전용 DB 대조 | **AI** |
| 5일 기록을 소급·일괄 생성하지 않고 실제 사용으로 채우기 | AI가 소급 생성을 거절하고, 실제 사용 방식으로 진행 |

## ⑥ 아직 막지 못한 부분

**미검증 (시험하지 않았다)**
- 토큰 실제 만료 거절(`node scripts/verify-session.mjs --wait-expiry`, 약 1시간).
- 배포본: 로그아웃 상태 첫 화면이 로그인인지, 시크릿 창에 자료가 보이지 않는지, 쿠키 속성(DevTools), Vercel 환경변수·배포 커밋.
- 실제 서비스에 대한 비밀번호 노출 검사(HAR·서버 로그), Vercel·Supabase 로그에 비밀번호가 남는지.
- 계정 삭제 화면(`/account`)의 브라우저 동작, 진행 중(열린) 구간의 통계 시간, 동시 요청(검사와 쓰기 사이 경쟁 조건).

**미구현**
- 비밀번호 변경·전체 기기 로그아웃(탈취 시 다른 세션을 끊을 방법 없음), 계획 삭제 API, `Idempotency-Key`의 사용자별 분리, 예시 계획을 화면에서 구분 표시(쓰기 거절이 일반 오류로 보임).

**알려진 한계 (실패는 아님)**
- 작업 시간 합계의 반올림 오차(할 일당 최대 0.5초).
- Free 플랜은 세션 고정·비활동 만료를 설정할 수 없다.
- 소유자 확인과 실제 쓰기가 서로 다른 쿼리다. RLS는 서버 경로에 적용되지 않는다.
- 삭제 직전에 서버가 받은 요청은 막지 못한다.
- 시험 중 **Confirm email이 꺼져 있었다.** 되돌린 시각은 **아직 확인하지 못했다.** 제출 전에 켜야 한다.

**실패:** 최종 실행에서 실패한 항목은 없다. (수정 전 빌드에서 접근 시험이 37개 실패한 것은 취약점 재현이며 수정 후 73/73이다.)

## 4줄 확인 방법

필요한 환경변수(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `TEST_EMAIL_*`, `TEST_PASSWORD_*`)는 각 스크립트 맨 위 주석에 있다. 개발 서버(`npm run dev`)를 켜 둔 상태에서 실행한다.

```bash
npm ci && npx tsc --noEmit && npx eslint . && node --test scripts/*.test.mjs
node scripts/verify-auth.mjs https://plan-do-see-silk.vercel.app
node scripts/verify-access.mjs && node scripts/verify-session.mjs && node scripts/verify-stats-export.mjs
node scripts/verify-account-deletion.mjs http://localhost:3000 --delete-test-account
```

## AI와 사용자 판단 요약

- AI는 코드·검증 스크립트·SQL·문서를 만들고, 가짜 서버로 시험하고, 읽기 전용 DB 조회로 결과를 대조했다.
- 사용자는 방식(서버 코드 소유권 확인, 404/403 정책, 계정 삭제 범위)을 결정하고, 실제 Supabase에서 시험을 실행하고, 커밋·푸시를 했다.
- 5일 사용 기록은 소급 생성하지 않고 실제 사용분만 기록하며, 채우지 못한 날짜는 미충족으로 적는다.

## 미해결 위험

1. 배포본 확인(첫 화면, 시크릿 창, 쿠키 속성, 배포 커밋)과 Confirm email 복구가 안 돼 있다.
2. 5일 사용 기록이 충족되지 않았다(진행 중).
3. 소유권 방어선이 서버 코드 한 곳이다. 새 API를 만들 때 `authorize*` 호출을 빠뜨리면 막히지 않는다.
4. 비밀번호 변경·전체 기기 로그아웃이 없어 탈취된 세션을 앱 안에서 끊을 수 없다.
5. 작업 시간 합계의 반올림 오차, 토큰 만료 실제 거절 미검증.

## 배포 확인 (제출 직전에 직접, 결과는 이 문서에 기록하기 전까지 미확인)

1. 로그아웃 상태로 `https://plan-do-see-silk.vercel.app` 열기 → 로그인 화면이 먼저 나오는가.
2. 시크릿 창에서 같은 주소 → 일기 자료가 보이지 않는가.
3. `git merge-base --is-ancestor f6b6a7740e5dde6ce86960eed6c13ba522e5618f HEAD` 성공, `git status` 깨끗, 소스 URL이 열림.
4. Vercel에서 배포된 커밋과 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 설정 확인, Supabase의 Confirm email 켜기.
5. `README.md`·이 문서에 비밀번호·토큰·서비스 키가 없는지 검색.
