"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { secondaryButton } from "@/app/ui-classes";

type Status = "idle" | "preparing" | "waiting" | "verifying";

const STATUS_TEXT: Record<Exclude<Status, "idle">, string> = {
  preparing: "서버에서 로그인 요청을 준비하는 중…",
  waiting: "브라우저의 패스키 창에서 안내를 따라 주세요…",
  verifying: "서버가 패스키를 확인하는 중…",
};

function browserErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";

  if (name === "NotAllowedError" || name === "AbortError") {
    return "패스키 로그인이 취소되었거나 시간이 지났습니다.";
  }

  if (name === "NotSupportedError" || name === "SecurityError") {
    return "이 브라우저나 주소에서는 패스키를 쓸 수 없습니다. HTTPS 주소와 최신 브라우저인지 확인하세요.";
  }

  return "패스키를 사용하지 못했습니다.";
}

async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;

    if (!res.ok || !json) {
      return { ok: false, message: json?.error ?? "서버에서 요청을 처리하지 못했습니다." };
    }

    return { ok: true, data: json };
  } catch {
    return { ok: false, message: "서버에 연결하지 못했습니다." };
  }
}

// 아이디·이메일을 입력하지 않는다. 브라우저가 이 사이트의 패스키를 보여 주면 사용자가 고른다.
// 누구로 로그인되는지는 서버가 서명을 검증한 결과로만 정해진다.
export default function PasskeyLoginButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);

    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setError("이 브라우저는 패스키를 지원하지 않습니다.");
      return;
    }

    setStatus("preparing");

    const started = await postJson<{
      challenge_id: string;
      options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
    }>("/api/passkeys/login/options", {});

    if (!started.ok) {
      setError(started.message);
      setStatus("idle");
      return;
    }

    setStatus("waiting");

    let credential;

    try {
      credential = await startAuthentication({ optionsJSON: started.data.options });
    } catch (caught) {
      setError(browserErrorMessage(caught));
      setStatus("idle");
      return;
    }

    setStatus("verifying");

    const verified = await postJson<{ redirect_to: string }>("/api/passkeys/login/verify", {
      challenge_id: started.data.challenge_id,
      response: credential,
    });

    if (!verified.ok) {
      setError(verified.message);
      setStatus("idle");
      return;
    }

    // 세션 쿠키가 새로 생겼으므로 화면 상태를 모두 버리는 전체 이동으로 계획 화면에 들어간다.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/plans");
  }

  const busy = status !== "idle";

  return (
    <div className="space-y-3">
      <button type="button" onClick={onClick} disabled={busy} className={`${secondaryButton} w-full`}>
        {busy ? "진행 중…" : "패스키로 로그인"}
      </button>

      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">
        {status !== "idle" ? STATUS_TEXT[status] : ""}
      </p>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
