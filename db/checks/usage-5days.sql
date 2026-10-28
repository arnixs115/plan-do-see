-- 5일 실제 사용 기록 확인 (읽기 전용: select 만 있다. 아무것도 바꾸지 않는다.)
-- Supabase SQL Editor에서 한 쿼리씩 실행한다.
--
-- 바꿔 쓸 값 두 개 (각 쿼리 맨 위 params):
--   email  : 사용 기록을 남기는 계정      (예: 'a-test@example.com')
--   prefix : 5일 사용 계획 제목의 앞부분  (예: '[TEST]')  ← [STATS-TEST], [ACCOUNT-DEL-TEST] 시험 자료와 구분된다
--
-- 날짜는 모두 Asia/Seoul 기준이다. 시각은 서버가 기록한 created_at / started_at 이며 SQL로 고치지 않는다.
-- ID는 앞 8자리만 보여 준다.

-- ===== 쿼리 1: 날짜별 기록 (서울 날짜 · 종류 · 식별자 · 소유자) =====
with params as (select 'a-test@example.com'::text as email, '[TEST]'::text as prefix),
me as (select u.id, u.email from auth.users u, params where lower(u.email) = lower(params.email)),
my_plans as (select p.* from plans p join me on p.user_id = me.id, params where p.title like params.prefix || '%'),
events as (
  select (p.created_at at time zone 'Asia/Seoul')::date as seoul_date, p.created_at as at, '계획 생성' as kind, left(p.id::text, 8) as id8, left(p.title, 30) as title
    from my_plans p
  union all
  select (t.created_at at time zone 'Asia/Seoul')::date, t.created_at, '할 일 생성', left(t.id::text, 8), left(t.title, 30)
    from todos t join my_plans p on p.id = t.plan_id
  union all
  select (e.started_at at time zone 'Asia/Seoul')::date, e.started_at, '실행 시작', left(e.id::text, 8), left(t.title, 30)
    from executions e join todos t on t.id = e.todo_id join my_plans p on p.id = t.plan_id
  union all
  select (e.ended_at at time zone 'Asia/Seoul')::date, e.ended_at, '실행 종료', left(e.id::text, 8), left(t.title, 30)
    from executions e join todos t on t.id = e.todo_id join my_plans p on p.id = t.plan_id where e.ended_at is not null
)
select seoul_date as "기록 날짜(서울)", to_char(at at time zone 'Asia/Seoul', 'HH24:MI:SS') as "시각", kind as "종류", id8 as "식별자(앞8자리)", (select left(email, 2) || '***' || substr(email, position('@' in email)) from me) as "소유자(마스킹)", title as "제목"
from events order by at;

-- ===== 쿼리 2: 5일 판정 (서로 다른 서울 날짜 수와 날짜 목록) =====
with params as (select 'a-test@example.com'::text as email, '[TEST]'::text as prefix),
me as (select u.id from auth.users u, params where lower(u.email) = lower(params.email)),
my_plans as (select p.* from plans p join me on p.user_id = me.id, params where p.title like params.prefix || '%'),
days as (
  select (t.created_at at time zone 'Asia/Seoul')::date as d from todos t join my_plans p on p.id = t.plan_id
  union select (e.started_at at time zone 'Asia/Seoul')::date from executions e join todos t on t.id = e.todo_id join my_plans p on p.id = t.plan_id
  union select (e.ended_at at time zone 'Asia/Seoul')::date from executions e join todos t on t.id = e.todo_id join my_plans p on p.id = t.plan_id where e.ended_at is not null
)
select count(*) as "서로 다른 서울 날짜 수", count(*) >= 5 as "5일 이상?", string_agg(d::text, ', ' order by d) as "날짜 목록" from days;

-- ===== 쿼리 3: 계획 수정(규칙 변경) 전/후 =====
-- plan_revisions.snapshot 은 "수정하기 직전" 값이다. 그래서
--   전 = 그 이력의 snapshot,  후 = 바로 다음 이력의 snapshot (없으면 지금 계획의 현재 값)
-- 비교 항목: 우선순위, 성공 기준, 목표일, 예상 시간(분). 수정 시각은 revised_at (서버 기록, 서울 시각).
with params as (select 'a-test@example.com'::text as email, '[TEST]'::text as prefix),
me as (select u.id from auth.users u, params where lower(u.email) = lower(params.email)),
my_plans as (select p.* from plans p join me on p.user_id = me.id, params where p.title like params.prefix || '%'),
revs as (
  select r.plan_id, r.revision_no, r.revised_at, r.snapshot as before_snap,
         coalesce(lead(r.snapshot) over (partition by r.plan_id order by r.revision_no), to_jsonb(p)) as after_snap
    from plan_revisions r join my_plans p on p.id = r.plan_id
)
select left(plan_id::text, 8) as "계획(앞8자리)", revision_no as "수정 번호",
       to_char(revised_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') as "수정 시각(서울)",
       concat_ws(' / ',
         case when before_snap->>'priority' is distinct from after_snap->>'priority' then '우선순위 ' || coalesce(before_snap->>'priority','-') || ' → ' || coalesce(after_snap->>'priority','-') end,
         case when before_snap->>'success_criteria' is distinct from after_snap->>'success_criteria' then '성공 기준 "' || coalesce(left(before_snap->>'success_criteria', 20),'-') || '" → "' || coalesce(left(after_snap->>'success_criteria', 20),'-') || '"' end,
         case when before_snap->>'target_date' is distinct from after_snap->>'target_date' then '목표일 ' || coalesce(before_snap->>'target_date','-') || ' → ' || coalesce(after_snap->>'target_date','-') end,
         case when before_snap->>'estimated_minutes' is distinct from after_snap->>'estimated_minutes' then '예상 시간 ' || coalesce(before_snap->>'estimated_minutes','-') || ' → ' || coalesce(after_snap->>'estimated_minutes','-') end
       ) as "바뀐 항목 (전 → 후)"
from revs order by plan_id, revision_no;

-- ===== 쿼리 4: 규칙 변경이 "2일째 뒤, 3일째 앞"인지 (날짜 순서 점검) =====
-- 사용 날짜를 오름차순으로 번호 매기고, 수정 시각의 서울 날짜가 몇 일째에 해당하는지 보여 준다.
-- 기대: 수정 날짜가 2일째 날짜 이상 3일째 날짜 이하(같은 날이면 시각 순서로 직접 확인).
with params as (select 'a-test@example.com'::text as email, '[TEST]'::text as prefix),
me as (select u.id from auth.users u, params where lower(u.email) = lower(params.email)),
my_plans as (select p.* from plans p join me on p.user_id = me.id, params where p.title like params.prefix || '%'),
days as (
  select (e.started_at at time zone 'Asia/Seoul')::date as d from executions e join todos t on t.id = e.todo_id join my_plans p on p.id = t.plan_id
  union select (t.created_at at time zone 'Asia/Seoul')::date from todos t join my_plans p on p.id = t.plan_id
),
numbered as (select d, row_number() over (order by d) as n from days)
select n as "n일째", d as "서울 날짜",
       (select string_agg('수정 ' || r.revision_no || ' @ ' || to_char(r.revised_at at time zone 'Asia/Seoul', 'HH24:MI'), ', ')
          from plan_revisions r join my_plans p on p.id = r.plan_id
         where (r.revised_at at time zone 'Asia/Seoul')::date = numbered.d) as "그날의 계획 수정"
from numbered order by n;
