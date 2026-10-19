# Plan-Do-See Diary

계획(Plan)을 세우고, 할 일을 실행(Do)하고, 결과를 확인(See)하는 다이어리의 백엔드 API입니다.
Next.js(App Router Route Handlers) + TypeScript + Supabase(PostgreSQL)로 만들었고 Vercel에 배포합니다.

> 현재는 **API만** 구현되어 있습니다. `app/page.tsx`는 create-next-app 기본 화면입니다.

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

`.env*` 파일은 Git에 올라가지 않습니다. 비밀 키는 코드, 로그, 채팅에 붙여넣지 않습니다.

## API

데이터는 모두 서버 API를 거쳐 접근하고, 브라우저가 Supabase를 직접 호출하지 않습니다.

| 영역 | 메서드와 경로 |
|---|---|
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
**실행할 때마다 `[API-TEST]` 계획이 1개씩 DB에 남습니다.** 끝나면 Supabase SQL Editor에서 지웁니다.

```sql
delete from public.plans where title like '[API-TEST]%';
```

## Vercel 배포

1. GitHub 저장소를 Vercel 프로젝트로 가져옵니다.
2. Project Settings > Environment Variables에 위 환경변수 2개를 넣습니다. (이름이 코드와 정확히 같아야 합니다.)
3. 배포 후 `GET https://<배포 주소>/api/plans`가 JSON을 돌려주는지 확인합니다.

## 보안 한계 (꼭 읽을 것)

**이 프로젝트에는 로그인이 없습니다.** 모든 API가 인증 없이 열려 있고, 서버는 비밀 키로 DB에 접근합니다.
배포 주소를 아는 사람은 누구나 다음을 할 수 있습니다.

- 계획·할 일·실행 기록을 만들고, 고치고, 지울 수 있습니다.
- `GET /api/export`로 **전체 데이터를 CSV로 내려받을 수 있습니다.**

따라서 공개되어도 괜찮은 시험·데모 데이터만 넣어야 합니다. 개인적인 내용이나 민감한 정보는 넣지 않습니다.
실제로 쓰려면 먼저 접근 제한(로그인 또는 토큰 검사)을 추가해야 합니다.
