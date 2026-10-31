# Plan-Do-See Diary

계획(Plan)을 세우고, 할 일을 실행(Do)하고, 결과를 확인(See)하는 다이어리의 백엔드 API입니다.
Next.js(App Router Route Handlers) + TypeScript + Supabase(PostgreSQL)로 만들었고 Vercel에 배포합니다.

> 계획 목록·상세, 할 일, 실행 타이머, 결과 요약 화면이 있고, 이메일 가입·로그인(Supabase Auth)이 붙어 있습니다. 인증 방식과 설정은 [`docs/auth.md`](docs/auth.md), 과제 7 제출 설명은 [`docs/assignment-7.md`](docs/assignment-7.md)를 봅니다.

## 실행하기

```bash
npm install
cp .env.example .env.local   # 값을 채운다 (아래 환경변수 참고)
npm run dev                  # http://localhost:3000
```

### 환경변수

| 이름 | 용도 | 비고 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 공개되어도 되는 값 |
| `SUPABASE_SECRET_KEY` | 서버가 DB에 접근하는 비밀 키 | **서버 전용.** `NEXT_PUBLIC_`을 붙이지 않는다 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 로그인(Supabase Auth)용 공개 키 | 공개되도록 만들어진 키. 비밀 키와 다른 값이다 |

`.env*` 파일은 Git에 올라가지 않습니다. 비밀 키는 코드, 로그, 채팅에 붙여넣지 않습니다.

## API

데이터는 모두 서버 API를 거쳐 접근하고, 브라우저가 Supabase를 직접 호출하지 않습니다.

**모든 API는 로그인이 필요합니다.** 로그인하지 않은 요청은 `401`입니다. (쿠키 세션 또는 `Authorization: Bearer <액세스 토큰>`)

| 영역 | 메서드와 경로 |
|---|---|
| Passkey | `GET /api/passkeys`(내 패스키 목록), `POST /api/passkeys/register/options`(등록 시작·챌린지 발급), `POST /api/passkeys/register/verify`(등록 결과 검증·공개 키 저장) |
| Plan | `GET /api/plans`, `POST /api/plans` |
| | `GET /api/plans/{plan_id}`, `PATCH /api/plans/{plan_id}` (수정 전 내용을 revision으로 보존) |
| Todo | `GET /api/plans/{plan_id}/todos`, `POST /api/plans/{plan_id}/todos` |
| | `GET /api/todos/{todo_id}`, `PATCH /api/todos/{todo_id}`, `DELETE /api/todos/{todo_id}` (soft delete) |
| Do | `POST /api/todos/{todo_id}/executions` (START, `Idempotency-Key` 헤더 필요) |
| | `POST /api/executions/{execution_id}/pause`, `/resume`, `/end` |
| | `GET /api/executions/{execution_id}` |
| See | `GET /api/plans/{plan_id}/summary` (계획 대비 실행 결과, 작업 시간은 초와 분) |
| Export | `GET /api/plans/{plan_id}/export`, `GET /api/export` (CSV, `?type=todos`(기본) 또는 `executions`) |

- 작업 시간은 실행 구간의 합이며 일시 정지 시간은 제외됩니다. 통계는 저장하지 않고 요청 때마다 계산합니다.
- Todo 상태는 일반 `PATCH`로 바꿉니다. 상태 변경 전용 엔드포인트는 없습니다.

## 데이터베이스

Supabase에 적용한 SQL은 [`db/`](db/README.md)에 기록되어 있습니다.
테이블과 함수는 서버(`service_role`)만 접근할 수 있고, 브라우저용 키(`anon`, `authenticated`)로는 접근할 수 없습니다.

## 동작 확인

서버를 켠 상태에서 다른 터미널에서 실행합니다.

```bash
node scripts/verify-api.mjs                      # 기본 http://localhost:3000
node scripts/verify-api.mjs http://localhost:3001
```

계획·할 일·실행·요약·내보내기를 실제 DB로 한 번씩 거치며 PASS/FAIL을 출력합니다.
모든 API가 로그인을 요구하므로, 이메일 확인을 마친 **시험용 계정**이 필요합니다. `ACCESS_TOKEN`을 주거나 아래 환경변수로 스크립트가 직접 로그인하게 합니다.
(비밀번호는 명령 기록에 남으니 시험 전용 계정만 씁니다. 토큰·비밀번호는 출력되지 않습니다.)

```bash
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... TEST_EMAIL=... TEST_PASSWORD=... node scripts/verify-api.mjs
```

인증 확인은 `scripts/verify-auth.mjs`(비로그인 차단은 계정 없이, 로그인·로그아웃·세션 폐기는 위 환경변수로)와 `node --test scripts/auth-validation.test.mjs`(입력 검사 단위 시험)를 씁니다.
**실행할 때마다 `[API-TEST]` 계획이 1개씩 DB에 남습니다.** 끝나면 Supabase SQL Editor에서 지웁니다.

```sql
delete from public.plans where title like '[API-TEST]%';
```

## Vercel 배포

1. GitHub 저장소를 Vercel 프로젝트로 가져옵니다.
2. Project Settings > Environment Variables에 위 환경변수 2개를 넣습니다. (이름이 코드와 정확히 같아야 합니다.)
3. 배포 후 `GET https://<배포 주소>/api/plans`가 JSON을 돌려주는지 확인합니다.

## 보안 한계 (꼭 읽을 것)

로그인이 붙었지만, **로그인한 사용자끼리의 자료 격리는 아직 끝나지 않았습니다.** (과제 7 카드 2에서 진행)

- 로그인하지 않은 요청은 모든 API에서 `401`이고, 페이지는 로그인 화면으로 이동합니다.
- 계획 **목록**과 **전체 내보내기**는 내 계획과 예시 계획만 돌려줍니다. 계획을 만들 때 소유자는 로그인한 사용자로 정해집니다.
- 그러나 **계획·할 일·실행을 id로 직접 부르는 API는 아직 소유자를 확인하지 않습니다.** 가입한 사용자가 다른 사용자의 id를 알면 읽고 고칠 수 있습니다. 예시 계획을 읽기 전용으로 막는 것도 아직 없습니다.
- 따라서 카드 2가 끝나기 전에는 **가입을 열어 둔 채로 실제 자료를 넣지 않습니다.** 공개되어도 괜찮은 시험·데모 데이터만 씁니다.
