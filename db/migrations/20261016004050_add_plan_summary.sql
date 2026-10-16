-- See: 계획 대비 실제 실행 결과를 한 번에 집계하는 읽기 전용 함수
--
--  * 통계는 저장하지 않고 요청할 때마다 todos / executions / execution_segments에서 계산한다.
--    (별도 통계 테이블 없음. 지침서: 계산 가능한 통계는 중복 저장하지 않는다.)
--  * 삭제(deleted_at)된 할 일과 그 할 일의 실행 기록은 집계에서 제외한다.
--  * 작업 시간(work_seconds)은 실행 구간(execution_segments)의 길이 합이다.
--    일시 정지 시간은 구간이 아니라서 자동으로 빠지고, 진행 중인 구간은 "지금"까지로 계산한다.
--  * 오류 코드(SQLSTATE): P0002 = 계획 없음
--  * 함수는 service_role(서버)만 실행할 수 있다.

create or replace function public.plan_summary(p_plan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan   public.plans%rowtype;
  v_now    timestamptz := clock_timestamp();
  v_result jsonb;
begin
  select * into v_plan
  from public.plans
  where id = p_plan_id;

  if not found then
    raise exception 'plan_not_found' using errcode = 'P0002';
  end if;

  with per_todo as (
    select
      t.id,
      t.title,
      t.status,
      t.estimated_minutes,
      t.created_at,
      (select count(*)
         from public.executions e
        where e.todo_id = t.id) as execution_count,
      (select count(*)
         from public.executions e
        where e.todo_id = t.id and e.ended_at is null) as active_execution_count,
      coalesce((
        select round(sum(extract(epoch from (coalesce(s.ended_at, v_now) - s.started_at))))
          from public.execution_segments s
          join public.executions e on e.id = s.execution_id
         where e.todo_id = t.id
      ), 0)::bigint as work_seconds
    from public.todos t
    where t.plan_id = p_plan_id
      and t.deleted_at is null
  )
  select jsonb_build_object(
    'plan', to_jsonb(v_plan),
    'revision_count', (select count(*) from public.plan_revisions r where r.plan_id = p_plan_id),
    'todo_counts', jsonb_build_object(
      'total',       count(*),
      'todo',        count(*) filter (where status = 'todo'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'completed',   count(*) filter (where status = 'completed')
    ),
    'completion_rate', case
      when count(*) = 0 then null
      else round(count(*) filter (where status = 'completed')::numeric / count(*), 4)
    end,
    'estimated_minutes', jsonb_build_object(
      'plan',  v_plan.estimated_minutes,
      'todos', coalesce(sum(estimated_minutes), 0)
    ),
    'actual', jsonb_build_object(
      'execution_count',        coalesce(sum(execution_count), 0),
      'active_execution_count', coalesce(sum(active_execution_count), 0),
      'work_seconds',           coalesce(sum(work_seconds), 0)
    ),
    'todos', coalesce(jsonb_agg(
      jsonb_build_object(
        'id',                     id,
        'title',                  title,
        'status',                 status,
        'estimated_minutes',      estimated_minutes,
        'execution_count',        execution_count,
        'active_execution_count', active_execution_count,
        'work_seconds',           work_seconds
      ) order by created_at, id
    ), '[]'::jsonb)
  )
  into v_result
  from per_todo;

  return v_result;
end;
$$;

-- 서버(service_role)만 실행할 수 있게 제한
revoke execute on function public.plan_summary(uuid) from public, anon, authenticated;
grant  execute on function public.plan_summary(uuid) to service_role;
