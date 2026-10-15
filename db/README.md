# db/

Supabase(PostgreSQL)에 적용한 SQL을 모아 두는 폴더입니다.

## migrations/

파일 이름은 `<버전>_<이름>.sql`이고, 버전은 Supabase에 기록된 마이그레이션 버전과 같습니다.
버전 순서대로 적용합니다.

| 버전 | 파일 | 내용 |
|---|---|---|
| 20261013075100 | `add_update_plan_with_revision` | 계획 수정 + revision 보존을 한 트랜잭션으로 처리하는 함수 `update_plan_with_revision` |
| 20261014083153 | `add_execution_segments_and_functions` | `execution_segments` 테이블, 부분 유니크 인덱스, 실행 함수 `start_execution` / `pause_execution` / `resume_execution` / `end_execution` / `execution_snapshot` |

## 사용 규칙

- 기본 테이블 4개(`plans`, `plan_revisions`, `todos`, `executions`)는 이 폴더보다 먼저 만들어져 있어서 생성 SQL이 없습니다.
- 이미 적용된 파일은 수정하지 않습니다. 바꿀 일이 있으면 새 버전 파일을 추가합니다.
- 이 SQL이 만든 함수와 테이블은 모두 서버(`service_role`)만 접근할 수 있고, 브라우저의 publishable key(`anon`, `authenticated`)로는 접근할 수 없습니다.
- 새 함수를 만들 때는 Supabase가 기본으로 `anon`, `authenticated`에 실행 권한을 부여하므로, 파일 끝에서 `revoke execute ... from public, anon, authenticated;` 후 `grant execute ... to service_role;`을 반드시 실행합니다.
- 이 폴더는 기록용입니다. Supabase에 적용하는 것은 별도 작업(대시보드의 SQL Editor 또는 마이그레이션 도구)입니다.
