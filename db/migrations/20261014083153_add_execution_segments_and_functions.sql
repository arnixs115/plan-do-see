-- 실행(Execution) 기능: 구간 테이블 + 상태 전이 함수 (START / PAUSE / RESUME / END)
--
-- 설계 요약
--  * 실행 상태는 컬럼으로 저장하지 않고 계산한다.
--      ended_at 이 있으면 ended, 열린 구간(ended_at is null)이 있으면 running, 둘 다 아니면 paused.
--  * 작업 시간은 "실제로 일한 구간"의 길이 합으로 계산한다. 일시 정지 시간은 구간이 아니므로 자동으로 빠진다.
--  * 중복 방지:
--      - START 는 idempotency_key 로 같은 요청을 알아본다. (executions.idempotency_key 는 이미 UNIQUE)
--      - PAUSE / RESUME / END 는 현재 상태를 보고 판단한다. 이미 그 상태면 아무것도 바꾸지 않고 현재 상태를 돌려준다.
--      - 함수를 거치지 않는 직접 삽입도 부분 유니크 인덱스가 막는다.
--  * 오류 코드(SQLSTATE): P0002 = 대상 없음, 55000 = 현재 상태에서 불가능한 요청,
--                          23505 = 같은 멱등성 키를 다른 할 일에 재사용, 22023 = 빈 멱등성 키
--  * 모든 함수는 service_role(서버)만 실행할 수 있다.

-- 1) 실행 구간 테이블: 시작~일시정지, 재개~종료 같은 "실제로 일한 구간"을 한 행씩 기록한다.
create table public.execution_segments (
  id           uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.executions(id) on delete cascade,
  started_at   timestamptz not null,
  ended_at     timestamptz,
  check (ended_at is null or started_at <= ended_at)
);

-- 실행 하나에 "열려 있는(끝나지 않은) 구간"은 최대 1개
create unique index execution_segments_one_open_idx
  on public.execution_segments (execution_id) where ended_at is null;
create index execution_segments_execution_id_idx
  on public.execution_segments (execution_id);

-- 할 일 하나에 "끝나지 않은 실행"은 최대 1개
create unique index executions_one_active_per_todo_idx
  on public.executions (todo_id) where ended_at is null;

-- 기존 테이블들과 동일하게: RLS 활성화, anon/authenticated 권한 없음(서버 service_role만 접근)
alter table public.execution_segments enable row level security;
revoke all on table public.execution_segments from anon, authenticated;

-- 2) 조회 헬퍼: 실행 하나의 현재 상태를 JSON으로 만든다.
create or replace function public.execution_snapshot(
  p_execution_id uuid,
  p_changed boolean default false,
  p_created boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'status', case
      when e.ended_at is not null then 'ended'
      when exists (select 1 from public.execution_segments s
                   where s.execution_id = e.id and s.ended_at is null) then 'running'
      else 'paused'
    end,
    'changed', p_changed,
    'created', p_created,
    'work_seconds', coalesce((
      select round(sum(extract(epoch from (coalesce(s.ended_at, clock_timestamp()) - s.started_at))))::bigint
      from public.execution_segments s
      where s.execution_id = e.id), 0),
    'execution', to_jsonb(e),
    'segments', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.started_at)
      from public.execution_segments s
      where s.execution_id = e.id), '[]'::jsonb)
  )
  from public.executions e
  where e.id = p_execution_id;
$$;

-- 3) START: 실행 시작. 같은 멱등성 키로 다시 호출하면 새로 만들지 않고 기존 실행을 돌려준다.
create or replace function public.start_execution(
  p_todo_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.executions%rowtype;
  v_exec_id  uuid;
  v_now      timestamptz;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;

  -- 할 일 행을 잠근다. 같은 할 일에 대한 동시 START는 여기서 순서대로 처리된다.
  perform 1 from public.todos
  where id = p_todo_id and deleted_at is null
  for update;

  if not found then
    raise exception 'todo_not_found' using errcode = 'P0002';
  end if;

  -- 같은 키로 이미 만든 실행이 있으면 그대로 돌려준다. (잠근 뒤에 확인해야 동시 요청도 안전하다)
  select * into v_existing
  from public.executions
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing.todo_id <> p_todo_id then
      raise exception 'idempotency_key_conflict' using errcode = '23505';
    end if;

    return public.execution_snapshot(v_existing.id, false, false);
  end if;

  -- 이미 진행 중(끝나지 않은)인 실행이 있으면 거절
  if exists (select 1 from public.executions
             where todo_id = p_todo_id and ended_at is null) then
    raise exception 'execution_already_active' using errcode = '55000';
  end if;

  -- 잠금을 얻은 "뒤"의 실제 시각을 쓴다. (트랜잭션 시작 시각 now()는 대기하는 동안 뒤처질 수 있다)
  v_now := clock_timestamp();

  insert into public.executions (todo_id, started_at, idempotency_key)
  values (p_todo_id, v_now, p_idempotency_key)
  returning id into v_exec_id;

  insert into public.execution_segments (execution_id, started_at)
  values (v_exec_id, v_now);

  return public.execution_snapshot(v_exec_id, true, true);
end;
$$;

-- 4) PAUSE: 열린 구간을 닫는다. 이미 일시 정지 상태면 아무것도 바꾸지 않고 현재 상태를 돌려준다.
create or replace function public.pause_execution(p_execution_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_exec   public.executions%rowtype;
  v_seg_id uuid;
begin
  select * into v_exec
  from public.executions
  where id = p_execution_id
  for update;

  if not found then
    raise exception 'execution_not_found' using errcode = 'P0002';
  end if;

  if v_exec.ended_at is not null then
    raise exception 'execution_already_ended' using errcode = '55000';
  end if;

  select id into v_seg_id
  from public.execution_segments
  where execution_id = p_execution_id and ended_at is null;

  if not found then
    return public.execution_snapshot(p_execution_id, false, false);
  end if;

  update public.execution_segments
  set ended_at = clock_timestamp()
  where id = v_seg_id;

  return public.execution_snapshot(p_execution_id, true, false);
end;
$$;

-- 5) RESUME: 새 구간을 연다. 이미 진행 중이면 아무것도 바꾸지 않고 현재 상태를 돌려준다.
create or replace function public.resume_execution(p_execution_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_exec public.executions%rowtype;
begin
  select * into v_exec
  from public.executions
  where id = p_execution_id
  for update;

  if not found then
    raise exception 'execution_not_found' using errcode = 'P0002';
  end if;

  if v_exec.ended_at is not null then
    raise exception 'execution_already_ended' using errcode = '55000';
  end if;

  if exists (select 1 from public.execution_segments
             where execution_id = p_execution_id and ended_at is null) then
    return public.execution_snapshot(p_execution_id, false, false);
  end if;

  insert into public.execution_segments (execution_id, started_at)
  values (p_execution_id, clock_timestamp());

  return public.execution_snapshot(p_execution_id, true, false);
end;
$$;

-- 6) END: 열린 구간을 닫고 실행을 끝낸다. 이미 끝났다면 아무것도 바꾸지 않고 결과를 돌려준다.
--    작업 시간(actual_minutes)은 구간 길이의 합으로 계산한다. (일시 정지 시간은 구간이 아니므로 제외)
create or replace function public.end_execution(
  p_execution_id uuid,
  p_blocker_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_exec  public.executions%rowtype;
  v_now   timestamptz;
  v_total numeric;
begin
  select * into v_exec
  from public.executions
  where id = p_execution_id
  for update;

  if not found then
    raise exception 'execution_not_found' using errcode = 'P0002';
  end if;

  if v_exec.ended_at is not null then
    return public.execution_snapshot(p_execution_id, false, false);
  end if;

  v_now := clock_timestamp();

  update public.execution_segments
  set ended_at = v_now
  where execution_id = p_execution_id and ended_at is null;

  select coalesce(sum(extract(epoch from (ended_at - started_at))), 0)
  into v_total
  from public.execution_segments
  where execution_id = p_execution_id;

  update public.executions
  set ended_at       = v_now,
      actual_minutes = round(v_total / 60)::int,
      blocker_reason = coalesce(p_blocker_reason, blocker_reason)
  where id = p_execution_id;

  return public.execution_snapshot(p_execution_id, true, false);
end;
$$;

-- 7) 서버(service_role)만 실행할 수 있게 제한
revoke execute on function public.execution_snapshot(uuid, boolean, boolean) from public, anon, authenticated;
grant  execute on function public.execution_snapshot(uuid, boolean, boolean) to service_role;
revoke execute on function public.start_execution(uuid, text) from public, anon, authenticated;
grant  execute on function public.start_execution(uuid, text) to service_role;
revoke execute on function public.pause_execution(uuid) from public, anon, authenticated;
grant  execute on function public.pause_execution(uuid) to service_role;
revoke execute on function public.resume_execution(uuid) from public, anon, authenticated;
grant  execute on function public.resume_execution(uuid) to service_role;
revoke execute on function public.end_execution(uuid, text) from public, anon, authenticated;
grant  execute on function public.end_execution(uuid, text) to service_role;
