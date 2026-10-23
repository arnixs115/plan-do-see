-- 과제 7 1단계(데이터 정리): 기존 시험 자료를 정리하고 남기는 1개를 예시로 전환한다.
--
--  * 남기는 계획: 9cd30dd6-4d6b-43ac-b936-460cc9433761 (가장 최근에 넣은 계획, 실행 기록 3개 포함)
--  * 지우는 계획 3개(할 일은 모두 삭제 처리된 것, 실행 기록 없음)는 id 를 직접 적어서 지운다.
--    "남길 것 외 전부 삭제"로 쓰지 않는 이유: 적용 사이에 새로 만든 계획이 함께 지워지는 것을 막기 위해서다.
--  * 지운 계획의 할 일·수정 이력은 기존 cascade 로 함께 지워진다.
--  * 마지막 CHECK: 소유자가 없는 계획은 예시뿐이어야 한다. 정리하지 않은 계획이 남아 있으면 이 줄에서 실패하고
--    전체가 취소된다. (데이터를 조용히 잃는 것보다 실패하는 쪽이 낫다)

do $$
begin
  if not exists (select 1 from public.plans where id = '9cd30dd6-4d6b-43ac-b936-460cc9433761') then
    raise exception 'keep_plan_missing';
  end if;

  delete from public.plans
  where id in (
    'e386df9d-7fc6-4b27-b0e1-8ed87a2399bd',
    '83d33c51-48b5-49c3-8e38-fbedabd17192',
    '77427a62-8830-4e10-9471-4aecef80d02a'
  );

  update public.plans
  set is_example = true
  where id = '9cd30dd6-4d6b-43ac-b936-460cc9433761';
end
$$;

alter table public.plans
  add constraint plans_owner_or_example_check
  check ((user_id is null) = is_example);
