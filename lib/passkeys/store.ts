import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { PasskeyView } from "./types";

// 패스키 표(passkey_credentials, passkey_registration_challenges)를 읽고 쓰는 곳.
// 서버 전용 키(SUPABASE_SECRET_KEY)로 접근하므로 RLS가 적용되지 않는다. (db/README.md 참고)
// 그래서 "이 사용자의 것인가"는 아래 함수들이 사용자 id 조건을 직접 거는 것으로 지킨다.
// 사용자 id 는 항상 호출하는 쪽이 requireUser() 로 확인한 값이어야 하고, 요청 본문에서 받은 값을 넘기지 않는다.

type DbError = { code?: string; message?: string } | null;

// 응답으로 내보내도 되는 열. credential_id, public_key, counter 는 화면이 쓸 일이 없어서 내보내지 않는다.
const VIEW_COLUMNS = "id, name, created_at, last_used_at, device_type, backed_up, aaguid, transports";

export async function listPasskeys(userId: string): Promise<{ data: PasskeyView[] | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin()
    .from("passkey_credentials")
    .select(VIEW_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return { data: data as PasskeyView[] | null, error };
}

// 같은 인증기에 같은 계정의 패스키를 두 번 만들지 않도록, 등록 옵션의 excludeCredentials 에 넣을 목록
export async function listCredentialRefs(
  userId: string
): Promise<{ data: { credential_id: string; transports: string[] }[] | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin()
    .from("passkey_credentials")
    .select("credential_id, transports")
    .eq("user_id", userId);

  return { data, error };
}

// 등록용 챌린지를 저장한다. 사용자·표시 이름과 묶이고 만료 시각은 DB가 정한다.
export async function createRegistrationChallenge(
  userId: string,
  challenge: string,
  name: string
): Promise<{ data: { challenge_id: string; expires_at: string } | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin().rpc("create_registration_challenge", {
    p_user_id: userId,
    p_challenge: challenge,
    p_name: name,
  });

  const row = Array.isArray(data) ? data[0] : null;

  return {
    data: row ? { challenge_id: row.challenge_id, expires_at: row.challenge_expires_at } : null,
    error,
  };
}

// 챌린지를 "쓴 것"으로 표시하면서 내용을 가져온다. UPDATE 한 문장이라 동시에 여러 요청이 와도 한 요청만 값을 받는다.
// 없는 id, 남의 챌린지, 이미 쓴 것, 만료된 것은 모두 data 가 null 이다. (이유를 구분하지 않는다)
export async function consumeRegistrationChallenge(
  challengeId: string,
  userId: string
): Promise<{ data: { challenge: string; name: string } | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin().rpc("consume_registration_challenge", {
    p_challenge_id: challengeId,
    p_user_id: userId,
  });

  const row = Array.isArray(data) ? data[0] : null;

  return {
    data: row ? { challenge: row.challenge_value, name: row.credential_name } : null,
    error,
  };
}

export type NewPasskey = {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  aaguid: string | null;
  name: string;
};

// 서버가 등록 결과를 검증한 뒤에만 부른다. 같은 credential_id 는 DB의 고유 제약이 막는다. (오류 코드 23505)
export async function insertPasskey(input: NewPasskey): Promise<{ data: PasskeyView | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin()
    .from("passkey_credentials")
    .insert({
      user_id: input.userId,
      credential_id: input.credentialId,
      public_key: input.publicKey,
      counter: input.counter,
      transports: input.transports,
      device_type: input.deviceType,
      backed_up: input.backedUp,
      aaguid: input.aaguid,
      name: input.name,
    })
    .select(VIEW_COLUMNS)
    .single();

  return { data: data as PasskeyView | null, error };
}

// ---- 로그인(카드 3) ----

// 로그인용 챌린지를 저장한다. 누구인지는 아직 모르므로 사용자와 묶이지 않는다. 만료 시각은 DB가 정한다.
export async function createLoginChallenge(
  challenge: string
): Promise<{ data: { challenge_id: string; expires_at: string } | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin().rpc("create_login_challenge", { p_challenge: challenge });
  const row = Array.isArray(data) ? data[0] : null;

  return {
    data: row ? { challenge_id: row.challenge_id, expires_at: row.challenge_expires_at } : null,
    error,
  };
}

// 로그인 챌린지를 원자적으로 소비하고 내용을 가져온다. 없는 id·이미 씀·만료는 모두 data 가 null 이다.
export async function consumeLoginChallenge(
  challengeId: string
): Promise<{ data: { challenge: string } | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin().rpc("consume_login_challenge", { p_challenge_id: challengeId });
  const row = Array.isArray(data) ? data[0] : null;

  return { data: row ? { challenge: row.challenge_value } : null, error };
}

export type StoredCredential = {
  credential_id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string[];
};

// 브라우저가 알려 준 credential ID 로 저장된 패스키를 찾는다. (사용자 id 는 요청에서 받지 않고 여기서 나온다)
export async function findCredentialById(
  credentialId: string
): Promise<{ data: StoredCredential | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin()
    .from("passkey_credentials")
    .select("credential_id, user_id, public_key, counter, transports")
    .eq("credential_id", credentialId);

  return { data: data && data.length === 1 ? (data[0] as StoredCredential) : null, error };
}

// 인증에 성공한 패스키의 카운터·마지막 사용 시각을 기록하고 소유자 id 를 돌려준다. 카운터가 올라가지 않았으면 data 가 null.
export async function recordPasskeyAuthentication(
  credentialId: string,
  newCounter: number
): Promise<{ data: { user_id: string } | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin().rpc("record_passkey_authentication", {
    p_credential_id: credentialId,
    p_new_counter: newCounter,
  });
  const row = Array.isArray(data) ? data[0] : null;

  return { data: row ? { user_id: row.owner_id } : null, error };
}
