-- 과제 8 카드 3: 패스키 로그인용 표와 함수 (추가만)
--
--  * 기존 표·함수는 건드리지 않는다. (create 만 있고 drop·alter 는 없다)
--  * passkey_login_challenges : 로그인을 시작할 때 서버가 만든 1회용 챌린지.
--      - 로그인 시작 시점에는 누구인지 모른다(아이디 입력 없이 패스키만 고른다). 그래서 사용자 열이 없다.
--        누구로 로그인되는지는 챌린지가 아니라, 서버가 저장된 공개 키로 서명을 검증한 뒤 credential_id 에 묶인 사용자로 정해진다.
--      - 서버리스에서는 요청마다 다른 인스턴스가 받을 수 있어 서버 메모리 대신 DB에 둔다.
--      - 만료(expires_at)와 소비(consumed_at)를 함께 관리한다.
--  * 소비는 UPDATE 한 문장이라 같은 챌린지로 동시에 요청해도 한 요청만 성공한다. 시간은 DB의 now() 기준이다.
--  * record_passkey_authentication : 서명 카운터를 "올라간 경우에만" 올리고 마지막 사용 시각을 기록한다. (복제된 인증기 탐지)
--  * 기존 표들과 같이: RLS 활성화, anon/authenticated 권한 없음(서버 service_role만 접근)

create table public.passkey_login_challenges (
  id          uuid        primary key default gen_random_uuid(),
  challenge   text        not null,                                  -- base64url 난수
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  constraint passkey_login_challenges_challenge_key unique (challenge),
  constraint passkey_login_challenges_challenge_check check (char_length(challenge) > 0)
);

alter table public.passkey_login_challenges enable row level security;

revoke all on public.passkey_login_challenges from anon, authenticated;
grant select, insert, update, delete on public.passkey_login_challenges to service_role;

-- 챌린지 만들기: 만료된 지 1시간 지난 오래된 챌린지를 정리하고 새 챌린지를 넣는다.
create function public.create_login_challenge(p_challenge text)
returns table (challenge_id uuid, challenge_expires_at timestamptz)
language sql
set search_path = ''
as $$
  with purge as (
    delete from public.passkey_login_challenges
     where expires_at < now() - interval '1 hour'
  )
  insert into public.passkey_login_challenges (challenge)
  values (p_challenge)
  returning id, expires_at;
$$;

-- 챌린지 소비: 아직 쓰이지 않았고 만료되지 않았을 때만 "쓴 것"으로 표시하고 내용을 돌려준다.
-- 조건에 맞는 행이 없으면(없는 id, 이미 씀, 만료) 빈 결과다. 이유는 구분하지 않는다.
create function public.consume_login_challenge(p_challenge_id uuid)
returns table (challenge_value text)
language sql
set search_path = ''
as $$
  update public.passkey_login_challenges c
     set consumed_at = now()
   where c.id = p_challenge_id
     and c.consumed_at is null
     and c.expires_at > now()
  returning c.challenge;
$$;

-- 인증에 성공한 패스키의 카운터와 마지막 사용 시각을 기록하고, 그 패스키의 소유자를 돌려준다.
-- 새 카운터가 저장된 값보다 커야 한다. (둘 다 0이면 카운터를 지원하지 않는 인증기라서 허용한다)
-- 조건에 맞지 않으면 빈 결과다. 서버는 이때 로그인을 거절한다.
create function public.record_passkey_authentication(p_credential_id text, p_new_counter bigint)
returns table (owner_id uuid)
language sql
set search_path = ''
as $$
  update public.passkey_credentials k
     set counter = p_new_counter,
         last_used_at = now()
   where k.credential_id = p_credential_id
     and (p_new_counter > k.counter or (p_new_counter = 0 and k.counter = 0))
  returning k.user_id;
$$;

revoke execute on function public.create_login_challenge(text) from public, anon, authenticated;
revoke execute on function public.consume_login_challenge(uuid) from public, anon, authenticated;
revoke execute on function public.record_passkey_authentication(text, bigint) from public, anon, authenticated;
grant execute on function public.create_login_challenge(text) to service_role;
grant execute on function public.consume_login_challenge(uuid) to service_role;
grant execute on function public.record_passkey_authentication(text, bigint) to service_role;
