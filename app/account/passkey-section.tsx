"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api, ApiError } from "@/lib/api-client";
import { inputClass, primaryButton } from "@/app/ui-classes";
import type { PasskeyView } from "@/lib/passkeys/types";

type Props = {
  initialPasskeys: PasskeyView[];
  // 서버가 목록을 읽지 못했을 때(예: 마이그레이션 미적용) 보여 줄 안내
  loadError: string | null;
};

type Status = "idle" | "preparing" | "waiting" | "saving";

const STATUS_TEXT: Record<Exclude<Status, "idle">, string> = {
  preparing: "서버에서 등록 요청을 준비하는 중…",
  waiting: "브라우저의 패스키 창에서 안내를 따라 주세요…",
  saving: "서버가 등록 결과를 확인하는 중…",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function browserErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";

  if (name === "NotAllowedError" || name === "AbortError") {
    return "패스키 등록이 취소되었거나 시간이 지났습니다. 저장된 것은 없습니다.";
  }

  if (name === "InvalidStateError") {
    return "이 기기(또는 패스키 제공자)에는 이 계정의 패스키가 이미 있습니다. 저장된 것은 없습니다.";
  }

  if (name === "NotSupportedError" || name === "SecurityError") {
    return "이 브라우저나 주소에서는 패스키를 만들 수 없습니다. HTTPS 주소와 최신 브라우저인지 확인하세요.";
  }

  return "패스키를 만들지 못했습니다. 저장된 것은 없습니다.";
}

export default function PasskeySection({ initialPasskeys, loadError }: Props) {
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const busy = status !== "idle";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setMessage({ kind: "error", text: "이 브라우저는 패스키를 지원하지 않습니다." });
      return;
    }

    try {
      setStatus("preparing");

      const started = await api<{ challenge_id: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>(
        "/api/passkeys/register/options",
        { method: "POST", body: JSON.stringify({ name }) }
      );

      setStatus("waiting");

      // 개인 키는 브라우저/패스키 제공자 안에서 만들어지고 밖으로 나오지 않는다. 여기서 받는 결과에는 공개 키와 서명만 있다.
      let credential;

      try {
        credential = await startRegistration({ optionsJSON: started.options });
      } catch (caught) {
        setMessage({ kind: "error", text: browserErrorMessage(caught) });
        return;
      }

      setStatus("saving");

      const saved = await api<{ passkey: PasskeyView }>("/api/passkeys/register/verify", {
        method: "POST",
        body: JSON.stringify({ challenge_id: started.challenge_id, response: credential }),
      });

      setPasskeys((current) => [...current, saved.passkey]);
      setName("");
      setMessage({ kind: "ok", text: `패스키 "${saved.passkey.name}"을(를) 등록했습니다.` });
    } catch (caught) {
      setMessage({
        kind: "error",
        text: caught instanceof ApiError ? caught.message : "패스키를 등록하지 못했습니다.",
      });
    } finally {
      setStatus("idle");
    }
  }

  return (
    <section className="mt-8 rounded-md border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">패스키</h2>
      <p className="mt-2 text-sm text-muted">
        이 기기나 패스키 제공자에 패스키를 만듭니다. 개인 키는 내 기기(또는 제공자)에만 남고 서버에는 공개 키만 저장됩니다.
        이름은 목록에서 구분하기 위한 표시용입니다.
      </p>

      <form onSubmit={onSubmit} className="mt-4 space-y-3" noValidate>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">패스키 이름</span>
          <input
            type="text"
            maxLength={40}
            autoComplete="off"
            placeholder="예: 내 노트북"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
        </label>

        <button type="submit" disabled={busy || name.trim() === ""} className={primaryButton}>
          {busy ? "진행 중…" : "패스키 등록"}
        </button>

        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">
          {status !== "idle" ? STATUS_TEXT[status] : ""}
        </p>

        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : ""}`}>
            {message.text}
          </p>
        )}
      </form>

      <h3 className="mt-6 text-sm font-semibold">등록된 패스키</h3>

      {loadError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {loadError}
        </p>
      ) : passkeys.length === 0 ? (
        <p className="mt-2 text-sm text-muted">아직 등록한 패스키가 없습니다.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line text-sm">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="py-2">
              <span className="font-medium break-all">{passkey.name}</span>
              <span className="block text-muted">등록: {formatDate(passkey.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
