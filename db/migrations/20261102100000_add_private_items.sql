-- 과제 8 카드 5: 계정별 비공개 항목 표와 함수 (추가만. 기존 표·함수는 건드리지 않는다)
--
--  * 카드 1~4 의 비공개 항목은 코드에 박힌 같은 가상 데이터를 모든 로그인 계정에 보여 주었다.
--    그래서 "내 것만 보인다"를 증명할 수 없었다. 이 마이그레이션은 항목에 소유자(user_id)를 붙인다.
--  * private_items      : 계정마다 따로 갖는 가상 비공개 항목. user_id 가 소유자이고, 사용자가 지워지면 함께 지워진다.
--                          (user_id, slot) 이 고유라서 한 계정에 같은 칸이 두 번 생기지 않는다.
--  * ensure_private_items(p_user_id) : 그 계정의 항목이 없으면 가상 항목 3개(메모·학습 목표·프로젝트 계획)를 만든다.
--                          이미 있으면 아무것도 하지 않는다. (on conflict do nothing → 여러 번 불러도, 동시에 불러도 안전)
--                          제목·본문에 "계정 태그"(사용자 id 의 해시 앞 6글자)를 넣어 계정마다 내용이 달라진다. 이메일은 쓰지 않는다.
--  * 모든 내용은 가상이다. 실제 사람·연락처·일정과 관계가 없다.
--  * 기존 표들과 같이: RLS 활성화, anon/authenticated 권한 없음(서버 service_role만 접근).
--    서버는 service_role 키를 쓰므로 RLS 를 거치지 않는다. 그래서 소유자 조건은 앱 코드(lib/private/items.ts)가 직접 건다.

create table public.private_items (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  slot       smallint    not null,
  code       text        not null,
  kind       text        not null,
  title      text        not null,
  body       text        not null,
  created_at timestamptz not null default now(),
  constraint private_items_user_slot_key unique (user_id, slot),
  constraint private_items_slot_check check (slot between 1 and 3),
  constraint private_items_kind_check check (kind in ('개인 메모', '학습 목표', '비공개 프로젝트 계획'))
);

create index private_items_user_id_idx on public.private_items (user_id);

alter table public.private_items enable row level security;

revoke all on public.private_items from anon, authenticated;
grant select, insert, update, delete on public.private_items to service_role;

create function public.ensure_private_items(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tag text := substr(md5(p_user_id::text), 1, 6);
begin
  insert into public.private_items (user_id, slot, code, kind, title, body)
  values
    (p_user_id, 1, 'PDEMO-' || v_tag || '-1', '개인 메모',
     '가상 메모: 주말에 정리할 것 (#' || v_tag || ')',
     '가상의 메모입니다. 계정 태그 ' || v_tag || ' 의 책상 서랍 정리하기, 읽다 만 가상의 책 3장까지 읽기.'),
    (p_user_id, 2, 'PDEMO-' || v_tag || '-2', '학습 목표',
     '가상 학습 목표: 인증 흐름 이해하기 (#' || v_tag || ')',
     '가상의 목표입니다. 계정 태그 ' || v_tag || ' 의 목표: 세션이 쿠키에 저장되는 방식을 그림으로 그려 설명할 수 있게 되기.'),
    (p_user_id, 3, 'PDEMO-' || v_tag || '-3', '비공개 프로젝트 계획',
     '가상 프로젝트: 별빛 일지 (#' || v_tag || ')',
     '가상의 프로젝트입니다. 계정 태그 ' || v_tag || ' 의 밤하늘 관측 기록 앱 구상. 아직 어디에도 공개하지 않은 설정입니다.')
  on conflict (user_id, slot) do nothing;
end;
$$;

revoke execute on function public.ensure_private_items(uuid) from public, anon, authenticated;
grant execute on function public.ensure_private_items(uuid) to service_role;
