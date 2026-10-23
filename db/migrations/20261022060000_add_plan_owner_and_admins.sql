-- 과제 7 1단계(추가만): 계획 소유자 컬럼과 admin 목록
--
--  * plans.user_id    : 계획의 소유자. 사용자가 지워지면 그 사용자의 계획도 함께 지워진다. (on delete cascade)
--                       todos / executions / execution_segments / plan_revisions 는 기존 cascade 로 따라 지워진다.
--                       소유자는 plans 에만 두고, 나머지 테이블은 plan 을 거쳐 소유자를 확인한다.
--  * plans.is_example : 모든 사용자에게 읽기 전용으로 보이는 예시 자료 표시. (소유자 없음)
--  * admins           : admin 사용자 목록. 서버(service_role)만 읽고 쓸 수 있다.
--                       admin 은 로그인 토큰 안의 값이 아니라 이 테이블로 판단한다.
--  * 기존 행은 이 파일에서 바꾸지 않는다. (user_id null, is_example false 로 남는다 → 다음 파일에서 정리)
--  * 소유자 규칙(user_id 가 null 인 것은 예시뿐)은 기존 자료를 정리한 뒤 다음 파일에서 CHECK 로 건다.

alter table public.plans
  add column user_id    uuid references auth.users (id) on delete cascade,
  add column is_example boolean not null default false;

create index plans_user_id_idx on public.plans (user_id);

create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 기존 테이블들과 동일하게: RLS 활성화, anon/authenticated 권한 없음(서버 service_role만 접근)
alter table public.admins enable row level security;
revoke all on table public.admins from anon, authenticated;
