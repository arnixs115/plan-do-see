-- admin 계정 등록 (손으로 한 번 실행하는 SQL: Supabase 대시보드 > SQL Editor)
--
-- admin 은 "예시 계획(plans.is_example = true)을 고치거나 지울 수 있는 사용자"다.
-- 그 밖의 권한은 없다. 남의 일반 계획은 admin 이어도 읽거나 고칠 수 없다. (lib/auth/access-rules.ts)
--
-- 순서
--   1) 앱의 가입 화면에서 admin 으로 쓸 계정을 먼저 만든다. (시험용이면 admin-test@example.com 같은 가짜 주소)
--   2) 아래 이메일을 그 계정으로 바꿔 실행한다. 한 줄이 들어가야 한다. (0줄이면 이메일이 틀린 것)
--   3) 이미 등록돼 있으면 아무 일도 하지 않는다. 되돌리려면 맨 아래 DELETE 를 쓴다.

insert into public.admins (user_id)
select id from auth.users where lower(email) = lower('admin-test@example.com')   -- ← 바꾼다
on conflict (user_id) do nothing
returning user_id;

-- 확인 (이메일은 가려서 보여 준다)
select left(u.email, 2) || '***' || right(u.email, 12) as admin_email_masked, a.created_at
from public.admins a join auth.users u on u.id = a.user_id;

-- 되돌리기 (필요할 때만 주석을 풀어 실행)
-- delete from public.admins where user_id = (select id from auth.users where lower(email) = lower('admin-test@example.com'));
