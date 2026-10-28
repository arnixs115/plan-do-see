"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { dangerButton, inputClass } from "@/app/ui-classes";

export default function DeleteAccountForm({ email }: { email: string }) {
  const [confirmEmail, setConfirmEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await api<void>("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ confirm_email: confirmEmail }),
      });

      // 계정이 없어졌으므로 화면 상태를 모두 버리는 전체 이동이 맞다. (lib/api-client.ts 의 401 처리와 같은 이유)
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "계정을 지우지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3" noValidate>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">
          삭제를 확인하려면 내 이메일(<span className="break-all">{email}</span>)을 입력하세요
        </span>
        <input
          type="email"
          autoComplete="off"
          value={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.value)}
          className={inputClass}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending || confirmEmail.trim() === ""} className={dangerButton}>
        {pending ? "삭제 중…" : "계정 영구 삭제"}
      </button>
    </form>
  );
}
