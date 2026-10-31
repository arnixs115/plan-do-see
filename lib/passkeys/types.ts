// 화면과 API가 함께 쓰는 패스키 표시용 타입. (서버 전용 값은 넣지 않는다: credential_id, public_key, counter 는 응답에 내보내지 않는다)

export type PasskeyView = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  device_type: "singleDevice" | "multiDevice";
  backed_up: boolean;
  aaguid: string | null;
  transports: string[];
};
