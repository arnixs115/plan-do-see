// 브라우저에서 우리 API(/api/...)를 부르는 작은 도우미.
// Supabase는 브라우저에서 직접 부르지 않고, 항상 서버 API를 거친다.

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }

  let response: Response;

  try {
    response = await fetch(path, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError("서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.", 0);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let data: unknown = null;

  try {
    data = await response.json();
  } catch {
    // JSON이 아닌 응답이면 아래에서 상태 코드로 메시지를 만든다.
  }

  // 로그인 세션이 없거나 만료된 경우: 로그인 화면으로 보낸다. (자료는 서버가 이미 거절했다)
  if (response.status === 401 && typeof window !== "undefined") {
    // 컴포넌트 밖의 공용 함수라 useRouter를 쓸 수 없고, 화면 상태를 모두 버리는 전체 이동이 맞다.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  if (!response.ok) {
    const error = (data as { error?: string | string[] } | null)?.error;
    const message = Array.isArray(error)
      ? error.join("\n")
      : (error ?? `요청에 실패했습니다. (${response.status})`);

    throw new ApiError(message, response.status);
  }

  return data as T;
}
