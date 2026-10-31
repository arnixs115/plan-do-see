-- 패스키 등록 점검 SQL (과제 8 카드 2). 읽기 전용(SELECT만). Supabase 대시보드 > SQL Editor에서 실행한다.
--
-- 이 파일은 공개 키·credential_id·챌린지 값 자체를 출력하지 않는다. 길이·개수·true/false·모델 식별값(aaguid)만 낸다.
-- (공개 키는 비밀이 아니지만, 화면 캡처에 긴 값이 섞이지 않게 하려는 것이다.)

-- 1) 표가 있고 열이 의도한 것뿐인가
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('passkey_credentials', 'passkey_registration_challenges')
order by table_name, ordinal_position;

-- 2) 개인 키·비밀값을 담을 만한 열이 없는가 (결과가 0행이어야 한다)
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('passkey_credentials', 'passkey_registration_challenges')
  and column_name ~* '(private|secret|priv_|password)';

-- 3) 브라우저용 키(anon, authenticated)로는 접근할 수 없는가 (모두 false 여야 한다)
select
  has_table_privilege('anon', 'public.passkey_credentials', 'select')                  as anon_select_credentials,
  has_table_privilege('authenticated', 'public.passkey_credentials', 'select')         as auth_select_credentials,
  has_table_privilege('anon', 'public.passkey_registration_challenges', 'select')      as anon_select_challenges,
  has_table_privilege('authenticated', 'public.passkey_registration_challenges', 'select') as auth_select_challenges,
  has_function_privilege('anon', 'public.consume_registration_challenge(uuid, uuid)', 'execute')   as anon_exec_consume,
  has_function_privilege('authenticated', 'public.create_registration_challenge(uuid, text, text)', 'execute') as auth_exec_create;

-- 4) 등록된 패스키 현황 (값 자체는 출력하지 않는다)
select
  count(*)                                   as passkeys,
  count(distinct user_id)                    as users,
  count(distinct credential_id)              as distinct_credential_ids,   -- passkeys 와 같아야 한다(중복 없음)
  min(char_length(public_key))               as public_key_len_min,
  max(char_length(public_key))               as public_key_len_max,
  count(*) filter (where counter < 0)        as bad_counter
from public.passkey_credentials;

-- 5) 모델 식별값(aaguid)별 개수. 제공자를 단정하려면 이 값을 공개 목록(passkeydeveloper/passkey-authenticator-aaguids)에서 직접 찾아 대조한다.
select coalesce(aaguid, '(없음)') as aaguid, device_type, backed_up, count(*) as passkeys
from public.passkey_credentials
group by 1, 2, 3
order by passkeys desc;

-- 6) 챌린지 상태: 대기 중 / 사용됨 / 만료됨
select
  count(*) filter (where consumed_at is null and expires_at > now())  as pending,
  count(*) filter (where consumed_at is not null)                     as consumed,
  count(*) filter (where consumed_at is null and expires_at <= now()) as expired_unused
from public.passkey_registration_challenges;
