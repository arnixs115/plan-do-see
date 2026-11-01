-- 과제 8 카드 5: 계정별 비공개 항목 격리 확인용 조회 (Supabase SQL Editor 에서 실행. 읽기 전용)
-- 교차 계정 시험 "전"과 "후"에 각각 실행해서 결과가 같은지 비교한다. (응답이 403/404 였다는 사실만으로는 데이터가 안 바뀌었다는 증명이 안 된다)
-- 이메일은 보여 주지 않고 사용자 id 앞 8글자만 쓴다.

-- 1. 계정별 항목 수와 내용 해시
select left(user_id::text, 8) as user_prefix,
       count(*)               as items,
       left(md5(string_agg(id::text || code || kind || title || body, '|' order by slot)), 12) as content_hash
from public.private_items
group by user_id
order by user_prefix;

-- 2. 한 항목이 두 계정에 걸쳐 있지 않은가 (0행이어야 함)
select code from public.private_items group by code having count(distinct user_id) > 1;

-- 3. 소유자 없는 항목 (0행이어야 함. user_id 는 not null 이라 원래 없다)
select id from public.private_items where user_id is null;

-- 4. RLS 와 권한: rowsecurity 가 true, anon/authenticated 에 권한 없음(0행)
select relrowsecurity from pg_class where oid = 'public.private_items'::regclass;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'private_items' and grantee in ('anon', 'authenticated');
