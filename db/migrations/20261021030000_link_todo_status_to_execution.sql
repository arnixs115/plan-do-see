-- 실행 시작·종료와 할 일 상태 연동
--
--  * START: 새 실행이 만들어질 때 할 일 상태를 'in_progress'로 바꾼다. (완료된 할 일을 다시 시작하는 경우 포함)
--  * END  : 실행이 실제로 끝날 때 할 일 상태를 'completed'로 바꾼다.
--  * PAUSE / RESUME 는 상태를 바꾸지 않는다.
--  * 아무것도 바꾸지 않은 재요청(같은 키의 START 재전송, 이미 끝난 실행의 END 재호출)은 상태도 건드리지 않는다.
--    (사용자가 그 뒤에 직접 바꾼 상태를 덮어쓰지 않기 위해서)
--  * 상태 변경은 실행 기록 변경과 같은 트랜잭션 안에서 일어나므로 둘이 어긋나지 않는다.
--  * 변경하는 함수는 start_execution, end_execution 두 개뿐이고, 나머지 본문은 이전과 같다.

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

  -- 실행이 시작되면 할 일을 '진행 중'으로 바꾼다.
  update public.todos
  set status = 'in_progress', updated_at = v_now
  where id = p_todo_id and status <> 'in_progress';

  return public.execution_snapshot(v_exec_id, true, true);
end;
$$;

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

  -- 실행이 끝나면 할 일을 '완료'로 바꾼다.
  update public.todos
  set status = 'completed', updated_at = v_now
  where id = v_exec.todo_id and status <> 'completed';

  return public.execution_snapshot(p_execution_id, true, false);
end;
$$;

-- 서버(service_role)만 실행할 수 있게 제한 (create or replace 는 기존 권한을 유지하지만, 규칙대로 다시 명시한다)
revoke execute on function public.start_execution(uuid, text) from public, anon, authenticated;
grant  execute on function public.start_execution(uuid, text) to service_role;
revoke execute on function public.end_execution(uuid, text) from public, anon, authenticated;
grant  execute on function public.end_execution(uuid, text) to service_role;
