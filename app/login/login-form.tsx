"use client";

import { useActionState } from "react";
import { login } from "@/app/auth/actions";
import type { AuthFormState } from "@/lib/auth/types";
import { inputClass, primaryButton } from "@/app/ui-classes";

const INITIAL: AuthFormState = {};

export default function LoginForm({ notice }: { notice?: string }) {
  const [state, formAction, pending] = useActionState(login, INITIAL);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {notice && (
        <p role="status" className="rounded-md border border-line bg-surface p-3 text-sm">
          {notice}
        </p>
      )}

      <label className="block text-sm">
        <span className="mb-1 block font-medium">이메일</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email ?? ""}
          className={inputClass}
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">비밀번호</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className={`${primaryButton} w-full`}>
        {pending ? "로그인 중…" : "로그인"}
      </button>
    </form>
  );
}
