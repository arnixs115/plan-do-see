"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/auth/client";
import type { AuthFormState } from "@/lib/auth/types";
import {
  AUTH_RATE_LIMITED_MESSAGE,
  AUTH_UNAVAILABLE_MESSAGE,
  LOGIN_FAILED_MESSAGE,
  classifyAuthError,
  loginErrorMessage,
  normalizeEmail,
  passwordProblem,
} from "@/lib/auth/validation";

// 가입 요청 뒤에 항상 같은 안내를 보여 준다.
// 이미 가입된 이메일이어도 같은 문구를 쓴다. (이 사이트에 가입된 이메일인지 알아내는 데 쓰이지 않게 하려는 것)
const SIGNUP_NOTICE =
  "가입 요청을 접수했습니다. 입력한 이메일로 확인 메일을 보냈으니 메일의 링크를 눌러 확인을 마치세요. " +
  "메일이 오지 않으면 이미 가입된 이메일일 수 있으니 로그인을 시도해 보세요.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// 이메일 확인 링크가 돌아올 주소의 기준(이 사이트 주소)
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return `${proto}://${host}`;
}

export async function login(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = normalizeEmail(field(formData, "email"));
  const password = field(formData, "password");

  // 형식이 이상한 입력도 "없는 계정"·"틀린 비밀번호"와 같은 문구로 돌려준다.
  if (!email || password.length === 0) {
    return { error: LOGIN_FAILED_MESSAGE, email: field(formData, "email").trim() };
  }

  const supabase = await createAuthClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: loginErrorMessage(error), email };
  }

  // redirect()는 예외로 동작하므로 try/catch 밖에서 호출한다.
  redirect("/plans");
}

export async function signup(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const rawEmail = field(formData, "email");
  const email = normalizeEmail(rawEmail);
  const password = field(formData, "password");
  const confirm = field(formData, "confirm");

  if (!email) {
    return { error: "올바른 이메일 주소를 입력하세요.", email: rawEmail.trim() };
  }

  const problem = passwordProblem(password);

  if (problem) {
    return { error: problem, email };
  }

  if (password !== confirm) {
    return { error: "비밀번호 확인이 일치하지 않습니다.", email };
  }

  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/confirm` },
  });

  if (error) {
    switch (classifyAuthError(error)) {
      case "unavailable":
        return { error: AUTH_UNAVAILABLE_MESSAGE, email };
      case "rate_limited":
        return { error: AUTH_RATE_LIMITED_MESSAGE, email };
    }

    if (error.code === "weak_password") {
      return { error: "비밀번호가 너무 약합니다. 더 길거나 복잡하게 만드세요.", email };
    }

    return { error: "가입을 처리하지 못했습니다. 입력을 확인하고 다시 시도하세요.", email };
  }

  // 프로젝트 설정에서 이메일 확인이 꺼져 있으면 가입과 동시에 로그인된다.
  if (data.session) {
    redirect("/plans");
  }

  return { notice: SIGNUP_NOTICE };
}
