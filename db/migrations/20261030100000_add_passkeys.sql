-- 과제 8 카드 2: 패스키(WebAuthn) 등록용 표와 함수 (추가만)
--
--  * 기존 표·함수는 건드리지 않는다. (create 만 있고 drop·alter 는 없다)
--  * passkey_credentials              : 등록이 끝난 패스키. credential_id 와 공개 키(public_key)만 저장한다.
--                                       개인 키는 사용자의 기기·패스키 제공자에 남고 서버로 오지 않는다. 그래서 저장할 개인 키 열이 아예 없다.
--  * passkey_registration_challenges  : 등록을 시작할 때 서버가 만든 1회용 챌린지.
--                                       서버리스에서는 요청마다 다른 인스턴스가 받을 수 있어 서버 메모리 대신 DB에 둔다.
--                                       만료(expires_at)와 소비(consumed_at)를 함께 관리하고, 사용자·이름과 묶어 둔다.
--  * 두 표 모두 사용자가 지워지면 함께 지워진다. (on delete cascade → 계정 삭제 때 패스키와 챌린지도 삭제)
--  * 챌린지의 생성과 소비는 함수로 한다. 시간은 서버 시계가 아니라 DB의 now()로 판단하고,
--    소비는 UPDATE 한 문장이라 같은 챌린지로 동시에 요청해도 한 요청만 성공한다.
--  * 기존 표들과 같이: RLS 활성화, anon/authenticated 권한 없음(서버 service_role만 접근)

create table public.passkey_credentials (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  credential_id text        not null,                  -- base64url. 같은 인증기·같은 서비스에서 고유한 값
  public_key    text        not null,                  -- COSE 공개 키(base64url). 공개 키이며 개인 키가 아니다
  counter       bigint      not null default 0,        -- 서명 카운터 (카드 3의 로그인 검증에서 쓴다)
  transports    text[]      not null default '{}',     -- 인증기가 알려 준 연결 방식(usb, nfc, hybrid, internal ...)
  device_type   text        not null,                  -- singleDevice(한 기기에 묶임) / multiDevice(동기화 가능)
  backed_up     boolean     not null,                  -- 지금 백업·동기화되어 있는지(등록 시점의 값)
  aaguid        text,                                  -- 인증기 모델 식별값. 제공자를 단정하는 근거가 아니라 참고값이다
  name          text        not null,                  -- 사용자가 붙인 표시용 이름. 인증 증거로 쓰지 않는다
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  constraint passkey_credentials_credential_id_key unique (credential_id),
  constraint passkey_credentials_credential_id_check check (char_length(credential_id) > 0),
  constraint passkey_credentials_public_key_check check (char_length(public_key) > 0),
  constraint passkey_credentials_counter_check check (counter >= 0),
  constraint passkey_credentials_device_type_check check (device_type in ('singleDevice', 'multiDevice')),
  constraint passkey_credentials_name_check check (char_length(btrim(name)) between 1 and 40)
);

create index passkey_credentials_user_id_idx on public.passkey_credentials (user_id);

create table public.passkey_registration_challenges (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  challenge    text        not null,                   -- base64url. 서버가 만든 예측하기 어려운 값
  pending_name text        not null,                   -- 이 등록에서 쓸 표시 이름. 검증 단계에서는 클라이언트가 보낸 이름을 쓰지 않는다
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '5 minutes'),
  consumed_at  timestamptz,
  constraint passkey_registration_challenges_challenge_key unique (challenge),
  constraint passkey_registration_challenges_name_check check (char_length(btrim(pending_name)) between 1 and 40)
);

create index passkey_registration_challenges_user_id_idx on public.passkey_registration_challenges (user_id);

alter table public.passkey_credentials enable row level security;
alter table public.passkey_registration_challenges enable row level security;

revoke all on table public.passkey_credentials from anon, authenticated;
revoke all on table public.passkey_registration_challenges from anon, authenticated;

grant select, insert, update, delete on table public.passkey_credentials to service_role;
grant select, insert, update, delete on table public.passkey_registration_challenges to service_role;

-- 챌린지 만들기: 이 사용자의 오래된(만료 1시간 지난) 챌린지를 정리하고 새 챌린지를 넣는다.
create function public.create_registration_challenge(p_user_id uuid, p_challenge text, p_name text)
returns table (challenge_id uuid, challenge_expires_at timestamptz)
language sql
set search_path = ''
as $$
  with purge as (
    delete from public.passkey_registration_challenges
     where user_id = p_user_id
       and expires_at < now() - interval '1 hour'
  )
  insert into public.passkey_registration_challenges (user_id, challenge, pending_name)
  values (p_user_id, p_challenge, p_name)
  returning id, expires_at;
$$;

-- 챌린지 소비: 이 사용자의 것이고, 아직 쓰이지 않았고, 만료되지 않았을 때만 "쓴 것"으로 표시하고 내용을 돌려준다.
-- 조건에 맞는 행이 없으면(없는 id, 남의 것, 이미 씀, 만료) 빈 결과다. 이유는 구분하지 않는다.
create function public.consume_registration_challenge(p_challenge_id uuid, p_user_id uuid)
returns table (challenge_value text, credential_name text)
language sql
set search_path = ''
as $$
  update public.passkey_registration_challenges c
     set consumed_at = now()
   where c.id = p_challenge_id
     and c.user_id = p_user_id
     and c.consumed_at is null
     and c.expires_at > now()
  returning c.challenge, c.pending_name;
$$;

revoke execute on function public.create_registration_challenge(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.consume_registration_challenge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_registration_challenge(uuid, text, text) to service_role;
grant execute on function public.consume_registration_challenge(uuid, uuid) to service_role;
