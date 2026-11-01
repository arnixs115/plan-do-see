-- 과제 8 카드 4: 패스키 개별 삭제 함수 (추가만. 표는 바꾸지 않는다)
--
--  * delete_passkey : "이 사용자의 이 패스키 하나"를 지운다. 사용자 id 는 서버가 로그인 세션에서 얻은 값이다.
--      - 남의 패스키·없는 패스키는 똑같이 'not_found' (존재 여부를 알려 주지 않는다)
--      - 마지막 패스키는 p_allow_last 가 true 일 때만 지운다. 아니면 'last_passkey' 로 거절한다.
--      - 같은 사용자의 패스키 행을 먼저 잠그고(FOR UPDATE) 개수를 센 뒤 지우므로, 두 개를 동시에 지워서
--        확인 없이 0개가 되는 일이 없다.
--  * 지워진 행은 로그인 검증(find·record_passkey_authentication)에서 찾을 수 없으므로 그 credential 은 즉시 로그인에 쓸 수 없다.
--  * 기존 표들과 같이: 브라우저용 역할(anon, authenticated)은 실행할 수 없고, 서버 service_role 만 실행한다.

create function public.delete_passkey(p_user_id uuid, p_passkey_id uuid, p_allow_last boolean)
returns table (outcome text, remaining integer)
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
  v_found boolean;
begin
  perform 1 from public.passkey_credentials where user_id = p_user_id order by id for update;

  select count(*) into v_total from public.passkey_credentials where user_id = p_user_id;

  select exists (
    select 1 from public.passkey_credentials where id = p_passkey_id and user_id = p_user_id
  ) into v_found;

  if not v_found then
    return query select 'not_found'::text, v_total;
    return;
  end if;

  if v_total = 1 and not p_allow_last then
    return query select 'last_passkey'::text, v_total;
    return;
  end if;

  delete from public.passkey_credentials where id = p_passkey_id and user_id = p_user_id;

  return query select 'deleted'::text, v_total - 1;
end;
$$;

revoke execute on function public.delete_passkey(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.delete_passkey(uuid, uuid, boolean) to service_role;
