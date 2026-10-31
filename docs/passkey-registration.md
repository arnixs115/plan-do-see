# 패스키 등록 (과제 8 카드 2)

로그인한 사용자가 **계정 화면(`/account`)** 에서 패스키를 등록한다. 서버에는 **공개 키와 credential ID**만 저장된다. 패스키로 로그인(카드 3)과 삭제(카드 4)는 아직 없다.

## 구성

| 항목 | 내용 |
| --- | --- |
| 라이브러리 | `@simplewebauthn/server` 14.0.3, `@simplewebauthn/browser` 14.0.0 |
| 등록 대상 | 항상 로그인한 사용자(`requireUser`). 요청에서 사용자 id·이메일을 받지 않는다 |
| 인증기 요구 | `residentKey: required`, `userVerification: required`, `attestationType: none` |
| 저장 | `passkey_credentials`(공개 키 등), `passkey_registration_challenges`(일회용 챌린지) — `db/migrations/20261030100000_add_passkeys.sql` |

## API

| 경로 | 역할 |
| --- | --- |
| `GET /api/passkeys` | 내 패스키 목록(이름, 등록·마지막 사용 일시, 기기 종류, AAGUID, transports). credential ID·공개 키·카운터는 내보내지 않는다 |
| `POST /api/passkeys/register/options` | 본문 `{name}`. 새 챌린지를 만들어 DB에 저장하고 `{challenge_id, expires_at, options}` 반환 |
| `POST /api/passkeys/register/verify` | 본문 `{challenge_id, response}`. 챌린지 소비 → 라이브러리 검증 → 통과 시에만 저장(201) |

## 챌린지

- 요청마다 라이브러리가 새 값을 만든다(32바이트 난수). 서버리스에서 인스턴스가 바뀌어도 쓸 수 있게 **메모리가 아니라 DB**에 둔다.
- 행에는 사용자, 표시 이름, 만료 시각(DB 시계 기준 5분), 소비 시각이 묶인다.
- verify 는 **먼저** 챌린지를 소비한다: `UPDATE … WHERE id=… AND user_id=… AND consumed_at IS NULL AND expires_at > now() RETURNING` 한 문장(`consume_registration_challenge`). 동시에 여러 요청이 와도 한 요청만 값을 받는다.
- 소비된 뒤에는 검증이 실패해도 같은 챌린지를 다시 쓸 수 없다. 다시 하려면 등록을 처음부터 시작한다.
- 없는 id·남의 챌린지·사용·만료는 모두 같은 400 으로 답한다(이유를 구분해 알려 주지 않는다).

## 서버 검증

`verifyRegistrationResponse` 에 기대 챌린지, `expectedOrigin`, `expectedRPID`, `requireUserPresence`, `requireUserVerification` 을 넘긴다. 실패하면 저장하지 않는다. `credential_id` 는 DB 고유 제약이 중복(다른 계정 포함)을 막고 409 로 답한다.

## 환경 변수

| 변수 | 개발 | 배포 |
| --- | --- | --- |
| `WEBAUTHN_ORIGIN` | 비우면 `http://localhost:3000` | 예: `https://plan-do-see-silk.vercel.app` (필수) |
| `WEBAUTHN_RP_ID` | 비우면 `localhost` | 예: `plan-do-see-silk.vercel.app` (필수) |
| `WEBAUTHN_RP_NAME` | 선택 | 선택 |

RP ID 는 패스키가 묶이는 도메인이다. **나중에 바꾸면 이미 만든 패스키를 쓸 수 없다.** Vercel 의 프리뷰 주소처럼 origin 이 다른 곳에서는 등록이 거부된다.

## DB 적용

저장소는 마이그레이션 파일만 기록한다. Supabase SQL Editor 에서 `db/migrations/20261030100000_add_passkeys.sql` 을 실행한 뒤 `db/checks/passkey-registration.sql` 로 확인한다. 기존 표는 건드리지 않는다. 마이그레이션 전에도 계정 화면은 열리며 패스키 구역에 안내 문구가 나온다.

## 어떤 제공자로 만들어졌는지 확인하는 방법

- 패스키 선택 창(브라우저·OS가 띄움)에 보이는 이름이 1차 단서다. 크롬은 "Google 비밀번호 관리자", 윈도우는 "Windows Hello", macOS/iOS는 "iCloud 키체인", 보안 키는 "USB 보안 키" 등으로 표시한다.
- 서버에는 AAGUID(인증기 모델 식별값), `device_type`(singleDevice/multiDevice), `backed_up`, `transports` 가 저장된다. `db/checks/passkey-registration.sql` 이 AAGUID 별 개수를 보여 준다.
- AAGUID 를 공개 목록(예: passkeydeveloper/passkey-authenticator-aaguids)에서 찾으면 제공자 이름을 알 수 있다. 목록에 없거나 `00000000-0000-0000-0000-000000000000` 이면 **제공자를 알 수 없다**고 보아야 한다(일부 제공자는 0으로 숨긴다). `attestationType: none` 이므로 제공자가 증명된 값은 아니다.
- 크롬 설정 > 자동 완성 및 비밀번호 > Google 비밀번호 관리자 > 패스키, 또는 OS의 패스키/비밀번호 앱에서 이 사이트의 패스키가 보이는지 직접 확인한다.

## 직접 확인하는 절차 (실제 브라우저·제공자)

1. 마이그레이션 적용 + Vercel 환경 변수 두 개 설정 + 재배포.
2. HTTPS 주소로 로그인 → `/account` → "패스키 이름" 입력 → "패스키 등록".
3. 브라우저/OS 창에서 지문·PIN 등으로 확인. 성공 문구와 목록에 이름·등록 일시가 나오는지 본다.
4. 창에서 **취소** → 취소 안내가 나오고 목록이 그대로인지 본다.
5. 새로고침해도 목록이 유지되는지, 다른 계정으로 로그인하면 목록이 비어 있는지 본다.
6. SQL Editor 에서 `db/checks/passkey-registration.sql` 실행(개수와 공개 키 길이만 나오고 키 값은 출력하지 않는다).
7. 스크린샷·로그에 쿠키, 토큰, `SUPABASE_SECRET_KEY` 가 보이지 않게 한다(개발자 도구 Network 탭의 요청 헤더 캡처 금지).

## 이 카드에서 하지 않은 것

패스키 로그인·로그아웃(카드 3), 패스키 삭제(카드 4), 두 패스키를 이용한 검증, 패스키 추가 시 최근 로그인 재확인.
