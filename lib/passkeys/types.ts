// 화면과 API가 함께 쓰는 패스키 표시용 타입. (서버 전용 값은 넣지 않는다: credential_id 전체, public_key, counter 는 응답에 내보내지 않는다)

export type PasskeyView = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  device_type: "singleDevice" | "multiDevice";
  backed_up: boolean;
  aaguid: string | null;
  transports: string[];
  // 목록에서 패스키를 구분하기 위한 표시용 값: credential ID 의 끝 6글자. 전체 ID·공개 키는 내보내지 않는다.
  credential_hint: string;
};
