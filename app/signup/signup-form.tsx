"use client";

import { useActionState } from "react";
import { signup } from "@/app/auth/actions";
import type { AuthFormState } from "@/lib/auth/types";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";
import { inputClass, primaryButton } from "@/app/ui-classes";

const INITIAL: AuthFormState = {};

export default function SignupForm() {
  const [state, formAction, pending] = useActionState(signup, INITIAL);

  return (
    <form action={formAction} className="space-y-4" noValidate>
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
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          className={inputClass}
        />
        <span className="mt-1 block text-muted">{PASSWORD_MIN_LENGTH}자 이상</span>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">비밀번호 확인</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass}
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      {state.notice && (
        <p role="status" className="rounded-md border border-line bg-surface p-3 text-sm">
          {state.notice}
        </p>
      )}

      <button type="submit" disabled={pending} className={`${primaryButton} w-full`}>
        {pending ? "가입 중…" : "가입하기"}
      </button>
    </form>
  );
}
