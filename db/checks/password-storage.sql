-- 비밀번호 저장 상태 점검 (읽기 전용: SELECT만 있고, 해시·비밀번호 값은 출력하지 않는다)
--
-- 실행 위치: Supabase 대시보드 > SQL Editor (postgres 권한).
--   앱의 서버 키(service_role)나 브라우저 키(anon, authenticated)로는 auth.users 를 읽을 수 없다.
--   그것이 정상이며, 이 파일은 앱에서 쓰는 파일이 아니라 "검증 기록용"이다.
--
-- 3번의 이메일만 시험 계정 두 개로 바꿔서 쓴다. 실제 사용자 이메일은 쓰지 않는다.

-- 1) 구조: 비밀번호가 저장되는 열은 무엇이고, public 스키마에 비밀번호 비슷한 열이 있는가
select table_schema, table_name, column_name, data_type
from information_schema.columns
where (table_schema = 'auth' and table_name = 'users' and column_name ~* 'pass')
   or (table_schema = 'public' and column_name ~* '(pass|pwd|secret|hash)')
order by 1, 2, 3;

-- 2) 형식: 저장된 값이 bcrypt 형식인가 (평문이면 이 정규식에 맞지 않는다)
--    bcrypt = `$2a$` + 비용(2자리) + `$` + 22자 salt + 31자 해시 = 60자
select count(*)                                                                            as users,
       count(*) filter (where encrypted_password ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$') as bcrypt_format,
       count(*) filter (where encrypted_password is null or encrypted_password = '')       as empty_password,
       count(distinct left(encrypted_password, 7))                                         as distinct_prefixes,
       min(length(encrypted_password))                                                     as min_len,
       max(length(encrypted_password))                                                     as max_len
from auth.users;

-- 3) 같은 비밀번호로 만든 두 계정 비교: 결과는 true/false 와 접두사(알고리즘·비용)뿐이다.
with emails(email) as (
  values ('first-test@example.com'), ('second-test@example.com')   -- ← 시험 계정 두 개로 바꾼다
),
pair as (
  select lower(u.email) as email, u.encrypted_password as h
  from auth.users u join emails e on lower(u.email) = lower(e.email)
)
select (select count(*) from pair)                                                    as found_accounts,   -- 2 여야 한다
       (select count(distinct h) from pair)                                           as distinct_hashes,  -- 2 면 서로 다름
       (select count(distinct substr(h, 8, 22)) from pair)                            as distinct_salts,   -- 2 면 salt 가 다름
       (select count(distinct left(h, 7)) from pair)                                  as distinct_prefixes, -- 1 이면 같은 알고리즘·비용
       (select min(left(h, 7)) from pair)                                             as algorithm_and_cost,
       (select bool_and(h ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$') from pair)    as all_bcrypt_format;

-- 4) 계정 목록 (이메일은 가려서 표시, 해시는 출력하지 않음)
select left(email, 2) || '***' || right(email, 12) as email_masked,
       (encrypted_password ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$') as bcrypt_format,
       left(encrypted_password, 7)                                       as algorithm_and_cost,
       email_confirmed_at is not null                                    as confirmed,
       created_at
from auth.users
order by created_at;
