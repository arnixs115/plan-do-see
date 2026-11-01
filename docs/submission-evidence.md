# 제출용 증거 정리 (과제 8)

상태 표기: **통과(로컬)** = 개발 샌드박스의 로컬 하네스에서 실행해 기대 결과 확인 / **미검증** = 아직 실행하지 못함(아래 절차로 직접 확인 필요).
스크린샷은 **하나도 캡처하지 않았다.** "캡처할 화면"은 직접 찍어야 하는 대상이다. 세션 토큰·쿠키 값·개인 키·비밀 환경변수는 가리고(앞 6글자+길이 정도만) 찍는다.

> 로컬 하네스 = 진짜 Postgres 17 + **가짜** Supabase Auth/PostgREST + 실제 `next start` 서버 + Chromium **가상** 인증기(CDP WebAuthn). 실제 Supabase·Vercel·실제 패스키 제공자(Google Password Manager, 보안 키 등)를 쓴 시험이 아니다.
> `app/layout.tsx`의 Google Fonts는 샌드박스에서 받을 수 없어 시험용 복사본에서만 뺐다. 저장소의 파일은 그대로다.

| # | 증거 이름 | 확인할 페이지/API | 실행 절차 | 기대 결과 | 실제 확인 결과 | 캡처할 화면·응답 | 상태 |
|---|---|---|---|---|---|---|---|
| 1 | 공개 화면 | `/` (시크릿 창) | 시크릿 창에서 배포 주소 열기 | 로그인 없이 웹 서비스 소개 페이지, 「로그인」「가입하기」 버튼 | 로컬: `/` 200, 소개 문구 21개 확인, 로그인으로 이동 안 함(`verify-intro` 11/11) | 시크릿 창 첫 화면 전체(주소창 포함) | 로컬 통과 · **배포 미검증** |
| 2 | 비공개 차단 | `GET /api/private-items` | 로그인 없이 호출: `curl -i <주소>/api/private-items` | 401, 항목 없음, `Cache-Control: no-store` | 로컬: 401 `{"error":"로그인이 필요합니다."}`. 항목 상세·`/private`도 비로그인 거부(401/307→/login) | 터미널의 상태줄 + 본문 | 로컬 통과 · **배포 미검증** |
| 3 | 패스키 등록 | `/account` | 로그인 → 이름 입력 → 「패스키 등록」 → 인증 | "등록했습니다" 메시지, 목록에 이름·등록 일시 | 로컬(가상 인증기): 등록 성공, 목록에 이름·일시 표시 | 등록 성공 메시지 + 패스키 목록 | 로컬 통과 · **실제 브라우저 미검증** |
| 4 | 공개 키 | Supabase SQL Editor | `db/checks/passkey-registration.sql` 조회 | `public_key`(COSE 공개 키)와 credential_id가 저장, 개인 키 열 없음 | 로컬: 공개 키 저장 확인(Ed25519 공개 키 42바이트 = 개인 키 성분 `d` 없는 크기), 표에 개인 키 열 자체가 없음 | 조회 결과(공개 키는 앞부분만 가리고 캡처) | 로컬 통과 · **실제 DB 미검증** |
| 5 | 등록 요청 | 브라우저 개발자 도구 Network → `POST /api/passkeys/register/verify` | 등록하면서 요청 본문 확인 | `id, rawId, response{attestationObject, clientDataJSON, transports}, type…` 만 있고 개인 키 항목 없음 | 로컬: 본문 키 구조 확인, `private`/`pkcs8` 문자열·`d` 키 없음 | 요청 본문(값은 앞 6글자만 보이게) | 로컬 통과 · **실제 브라우저 미검증** |
| 6 | 챌린지 | `POST /api/passkeys/login/options` ×2, `…/login/verify` 재전송 | 옵션을 두 번 요청해 챌린지 비교, 같은 결과를 두 번 전송 | 챌린지 서로 다름, 재사용은 400 | 로컬: 챌린지 서로 다름(43자씩 다른 값), 첫 전송 200 → 재전송 **400** `로그인 요청이 만료되었거나 이미 사용되었습니다…`, DB에서 소비됨 | 두 응답의 challenge 앞 6글자, 재사용 거부 응답 | 로컬 통과 · **실제 브라우저 미검증** |
| 7 | 서명 검증 | `POST /api/passkeys/login/verify` | 정상 서명 vs 서명 마지막 1바이트 변조 | 정상 200+세션 쿠키, 변조 401+쿠키 없음 | 로컬: 정상 **200**(쿠키 1개, HttpOnly·SameSite=Lax·7일), 변조 **401**(쿠키 0개) | 두 응답(쿠키 값 가림) | 로컬 통과 · 변조 요청은 개발자 도구로 직접 만들기 어렵다(하네스에서 붙잡은 결과를 변조) → **실제 브라우저 미검증** |
| 8 | 로그아웃 | `POST /api/auth/logout`, `GET /api/private-items` | 로그아웃 → 이전 쿠키/토큰으로 재요청 | 204, 이후 401, 뒤로 가기에도 비공개 화면 안 보임 | 로컬: 204, 쿠키 401 / Bearer 401, 옛 쿠키로 `/private` 307→/login, 뒤로 가기·새로고침 후에도 로그인 화면 | 로그아웃 후 401 응답 | 로컬 통과 · **실제 브라우저 미검증** |
| 9 | 패스키 삭제 | `/account` 삭제 버튼, `DELETE /api/passkeys/{id}` | 패스키 2개 → A 삭제 → 로그아웃 → B로 로그인 | B 로그인 성공, 비공개 조회 200 | 로컬: A만 삭제, B로 로그인 성공, `/api/private-items` 200 | 삭제 확인 창, 삭제 후 목록, B 로그인 후 `/private` | 로컬 통과 · **실제 브라우저 미검증** |
| 10 | 삭제된 패스키 | `POST /api/passkeys/login/verify` | 삭제된 A의 로그인 결과로 인증 시도 | 401, 새 세션 없음 | 로컬: 삭제 전에 만든 결과 **401**, 삭제 뒤 인증기가 A를 후보로 내놓아도 새 서명 **401**, 세션 발급 수 변화 없음(23→23). 인증기가 A를 제공하지 않는 경우는 하네스에서 발생하지 않았다 | 로그인 실패 메시지, 401 응답 | 로컬 통과 · **실제 브라우저 미검증** |
| 11 | 계정 격리 | `GET /api/private-items/{item_id}` 등 | 계정 A 세션으로 B 항목 id·`?user_id=B`·헤더·본문 변조(그리고 반대) | 상대 항목 404, 목록은 내 것만 | 로컬 `A→B` 24건·`B→A` 24건(+ 비로그인·로그아웃·만료·전후 비교 등 13건, 합계 61건) 모두 통과(상대 항목 404, 변조해도 내 목록만, 쓰기 405) + 브라우저 세션으로도 404 | 두 방향의 404 응답, 내 항목 200 | 로컬 통과 · **실제 배포 미검증**(`scripts/verify-isolation.mjs`로 확인) |
| 12 | 데이터 무결성 | `db/checks/private-isolation.sql` | 교차 시험 **전/후** 실행해 비교 | 계정별 항목 수·내용 해시 동일 | 로컬 실측: A 3→3(해시 동일), B 3→3(해시 동일), 패스키 수 A 1→1 / B 1→1 | 전/후 조회 결과 | 로컬 통과 · **실제 DB 미검증** |

## 배포·공개 접근성 점검표 (카드 5 §7)

| 조건 | 확인 결과 |
|---|---|
| 결과물 HTTPS 주소 | 문서에 적힌 주소 `https://plan-do-see-silk.vercel.app` — **이 세션에서 접속해 확인하지 못함**(샌드박스 외부 접속 제한). 미검증 |
| 소스 코드 HTTPS 주소 | `https://github.com/arnixs115/plan-do-see` — **인증 없이 `git clone`이 성공**했다(이 세션에서 실제 실행). 공개 저장소로 읽힌다. 웹 페이지(github.com) 접속과 Public 표시는 미검증 |
| 시크릿 창 첫 화면 = 공개 소개 | 코드상 `/`는 `proxy.ts`에서 공개, 로컬에서 200 확인. 배포본은 **미검증**(카드 1 때 사용자가 배포본에서 확인한 흐름이 있으나 이번 카드의 최종 배포본은 아님) |
| 소개를 보는 데 로그인·패스키 불필요 | 로컬 통과. 배포본 미검증 |
| Vercel Authentication / SSO / CAPTCHA 없음 | 저장소에 `vercel.json`이 없고 코드에 CAPTCHA 없음. **Vercel 프로젝트 설정(Deployment Protection)은 이 세션에서 볼 수 없어 미검증** — Vercel 대시보드 Settings → Deployment Protection 에서 "Vercel Authentication"이 꺼져 있어야 한다 |
| 비공개 데이터는 인증 없이 접근 불가 | 로컬 통과. 배포본 미검증 |
| 저장소에 비밀값 없음 | 추적 파일·전체 이력(29개 커밋)에서 `sb_secret_…`, JWT 형태 문자열, 개인 키 블록, `SUPABASE_SECRET_KEY=<값>` 패턴 **0건**. `.env*`는 `.gitignore` 대상이고 `.env.example`만 추적(값 없음). 패턴 검색이므로 모든 형태의 비밀을 보장하지는 않는다 |
| 실제 배포 실행 | **하지 않았다.** 배포 완료로 기록하지 않는다 |

## 직접 확인 절차 요약 (실제 환경)

1. Supabase SQL Editor에서 `db/migrations/20261101100000_add_delete_passkey.sql`(카드 4, 아직이면), `20261102100000_add_private_items.sql`(카드 5) 실행.
2. 로컬 `npm run build` 후 배포(Vercel은 `main` 푸시 시 자동 배포 — **푸시는 확인 후 직접**). 환경변수는 기존 그대로(`WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_ID` 포함).
3. 가상 테스트 계정 A, B를 **가입 → 이메일 확인**(실제 메일함이 필요한 가상 주소 사용)하고, 각각 **다른 브라우저 프로필(또는 다른 기기)** 에서 `/account`에서 패스키를 등록한다.
4. `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… TEST_EMAIL_A=… TEST_PASSWORD_A=… TEST_EMAIL_B=… TEST_PASSWORD_B=… node scripts/verify-isolation.mjs https://<배포 주소>` 실행 → 양방향 시험과 전후 표가 출력된다.
5. `db/checks/private-isolation.sql`을 시험 전·후에 SQL Editor에서 실행해 비교한다.
6. 시크릿 창에서 `/`, `/private`(로그인으로 이동), `/api/private-items`(401)를 확인하고 캡처한다.
