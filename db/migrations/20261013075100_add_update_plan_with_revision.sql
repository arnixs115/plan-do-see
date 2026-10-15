-- 계획 수정 + revision 보존을 하나의 트랜잭션으로 처리하는 함수
--
--  * 수정 "전" 내용을 plan_revisions.snapshot(jsonb)에 저장한 뒤 plans를 갱신한다.
--  * for update 로 계획 행을 잠가서 같은 계획에 대한 동시 수정이 순서대로 처리되고 revision_no 가 겹치지 않는다.
--  * 전달된 키(p_updates)만 갱신하고, 없는 키는 기존 값을 유지한다.
--  * 오류 코드(SQLSTATE): P0002 = 계획 없음. 값 문제는 테이블의 CHECK 제약조건이 막는다.
--  * service_role(서버)만 실행할 수 있다.

create or replace function public.update_plan_with_revision(
  p_plan_id uuid,
  p_updates jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current     public.plans%rowtype;
  v_updated     public.plans%rowtype;
  v_revision_no integer;
begin
  -- 1. 해당 계획 행을 잠그고 현재 값을 읽는다 (동시 수정 요청은 여기서 대기)
  select * into v_current
  from public.plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception 'plan_not_found' using errcode = 'P0002';
  end if;

  -- 2. 다음 revision 번호 계산 (행이 잠겨 있으므로 충돌하지 않음)
  select coalesce(max(revision_no), 0) + 1
  into v_revision_no
  from public.plan_revisions
  where plan_id = p_plan_id;

  -- 3. 수정 "전" 내용을 snapshot으로 보존
  insert into public.plan_revisions (plan_id, revision_no, snapshot)
  values (p_plan_id, v_revision_no, to_jsonb(v_current));

  -- 4. 전달된 키만 갱신 (없는 키는 기존 값 유지)
  update public.plans set
    title             = case when p_updates ? 'title'             then p_updates->>'title'                      else title end,
    description       = case when p_updates ? 'description'       then p_updates->>'description'                else description end,
    start_date        = case when p_updates ? 'start_date'        then (p_updates->>'start_date')::date         else start_date end,
    end_date          = case when p_updates ? 'end_date'          then (p_updates->>'end_date')::date           else end_date end,
    target_date       = case when p_updates ? 'target_date'       then (p_updates->>'target_date')::date        else target_date end,
    priority          = case when p_updates ? 'priority'          then p_updates->>'priority'                   else priority end,
    success_criteria  = case when p_updates ? 'success_criteria'  then p_updates->>'success_criteria'           else success_criteria end,
    estimated_minutes = case when p_updates ? 'estimated_minutes' then (p_updates->>'estimated_minutes')::int   else estimated_minutes end,
    next_plan_note    = case when p_updates ? 'next_plan_note'    then p_updates->>'next_plan_note'             else next_plan_note end,
    updated_at        = now()
  where id = p_plan_id
  returning * into v_updated;

  return jsonb_build_object(
    'revision_no', v_revision_no,
    'plan', to_jsonb(v_updated)
  );
end;
$$;

-- 서버(service_role)만 실행 가능하게 제한
revoke execute on function public.update_plan_with_revision(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_plan_with_revision(uuid, jsonb)
  to service_role;
