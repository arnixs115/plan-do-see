"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api, ApiError } from "@/lib/api-client";
import { dangerButton, inputClass, primaryButton, secondaryButton } from "@/app/ui-classes";
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

  // 삭제: 이름을 보여 주며 확인을 받은 뒤 서버에 요청한다. 서버가 로그인한 사용자의 패스키인지 확인하고 지운다.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function onDelete(passkey: PasskeyView) {
    setMessage(null);
    setDeletingId(passkey.id);

    // 마지막 패스키는 서버가 ?confirm_last=1 이 있어야 지운다. 이 확인은 아래 안내 문구를 본 뒤 눌렀을 때만 보낸다.
    const isLast = passkeys.length === 1;

    try {
      await api<{ deleted: boolean; remaining: number }>(`/api/passkeys/${passkey.id}${isLast ? "?confirm_last=1" : ""}`, {
        method: "DELETE",
      });

      setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
      setMessage({
        kind: "ok",
        text: `패스키 "${passkey.name}"을(를) 서버에서 삭제했습니다. 기기나 패스키 관리자에 저장된 패스키는 그대로이니 필요하면 직접 지우세요.`,
      });
    } catch (caught) {
      setMessage({ kind: "error", text: caught instanceof ApiError ? caught.message : "패스키를 삭제하지 못했습니다." });
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

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
      <p className="mt-1 text-xs text-muted">
        이름은 구분하기 위한 표시용이며 패스키가 실제로 저장된 기기나 제공자를 뜻하지 않습니다. 동기화되는 패스키는 여러 기기에서 쓰일 수 있습니다.
        다른 기기나 제공자의 패스키를 더 등록하려면 그 기기에서 이 화면을 열어 등록하세요.
      </p>

      {loadError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {loadError}
        </p>
      ) : passkeys.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          아직 등록한 패스키가 없습니다. 패스키 로그인은 패스키를 등록해야 쓸 수 있고, 지금은 이메일과 비밀번호로 로그인합니다.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line text-sm">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium break-all">{passkey.name}</span>
                  <span className="block text-muted">등록: {formatDate(passkey.created_at)}</span>
                  <span className="block text-muted">
                    마지막 로그인: {passkey.last_used_at ? formatDate(passkey.last_used_at) : "아직 없음"}
                  </span>
                  <span className="block text-xs text-muted">
                    구분 번호 …{passkey.credential_hint} ·{" "}
                    {passkey.device_type === "multiDevice" ? "동기화될 수 있는 패스키" : "한 기기에 묶인 패스키"}
                  </span>
                </div>

                {confirmingId !== passkey.id && (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(passkey.id)}
                    disabled={deletingId !== null}
                    className={secondaryButton}
                    aria-label={`패스키 ${passkey.name} 삭제`}
                  >
                    삭제
                  </button>
                )}
              </div>

              {confirmingId === passkey.id && (
                <div role="alertdialog" aria-label="패스키 삭제 확인" className="mt-3 rounded-md border border-danger p-3">
                  <p className="m-0 font-medium">패스키 &quot;{passkey.name}&quot;을(를) 삭제할까요?</p>
                  <p className="mt-1 mb-0 text-muted">
                    서버에 등록된 이 패스키만 지워지고, 이후 이 패스키로는 로그인할 수 없습니다. 내 기기나 패스키 관리자에 저장된 패스키 자체는
                    자동으로 지워지지 않으니 필요하면 직접 지우세요.
                  </p>
                  {passkeys.length === 1 && (
                    <p className="mt-2 mb-0 font-medium text-danger">
                      마지막 패스키입니다. 지우면 패스키로 로그인할 수 없게 됩니다. 이 계정은 이메일과 비밀번호로 계속 로그인할 수 있고,
                      로그인한 뒤 이 화면에서 패스키를 다시 등록할 수 있습니다. 비밀번호를 모르면 계정에 들어올 방법이 없으니 꼭 확인하세요.
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => onDelete(passkey)} disabled={deletingId !== null} className={dangerButton}>
                      {deletingId === passkey.id ? "삭제 중…" : "삭제 확인"}
                    </button>
                    <button type="button" onClick={() => setConfirmingId(null)} disabled={deletingId !== null} className={secondaryButton}>
                      취소
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
