"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatMinutes, formatPeriod } from "@/lib/format";
import { PRIORITY_LABEL } from "@/lib/labels";
import type { Plan, Priority } from "@/lib/types";

// 우선순위는 왼쪽 선의 색으로 보여 주고, 색만으로 구분하지 않도록 글자도 함께 쓴다.
const PRIORITY_RULE: Record<Priority, string> = {
  high: "border-l-p-high",
  medium: "border-l-p-medium",
  low: "border-l-p-low",
};

type FormState = {
  title: string;
  description: string;
  priority: Priority;
  start_date: string;
  end_date: string;
  estimated_minutes: string;
  success_criteria: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  priority: "medium",
  start_date: "",
  end_date: "",
  estimated_minutes: "",
  success_criteria: "",
};

// 비어 있는 칸은 보내지 않는다. (보내지 않으면 서버/DB의 기본값이 들어간다)
function buildBody(form: FormState) {
  const body: Record<string, unknown> = {
    title: form.title,
    priority: form.priority,
  };

  if (form.description.trim()) body.description = form.description;
  if (form.success_criteria.trim()) body.success_criteria = form.success_criteria;
  if (form.start_date) body.start_date = form.start_date;
  if (form.end_date) body.end_date = form.end_date;
  if (form.estimated_minutes.trim() !== "") {
    body.estimated_minutes = Number(form.estimated_minutes);
  }

  return body;
}

export default function PlansBoard() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // reloadKey가 바뀌면 목록을 다시 불러온다. (처음 한 번 + '다시 불러오기' 버튼)
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    api<Plan[]>("/api/plans")
      .then((data) => {
        if (!cancelled) setPlans(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof ApiError ? error.message : "계획을 불러오지 못했습니다.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function retry() {
    setLoadError(null);
    setReloadKey((key) => key + 1);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) return;

    setSubmitting(true);
    setFormError(null);
    setCreated(null);

    try {
      const plan = await api<Plan>("/api/plans", {
        method: "POST",
        body: JSON.stringify(buildBody(form)),
      });

      setPlans((prev) => [plan, ...(prev ?? [])]);
      setForm(EMPTY_FORM);
      setCreated(`'${plan.title}' 계획을 만들었습니다.`);
      titleRef.current?.focus();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "계획을 만들지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <section aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="mb-4 text-xl font-semibold">
          내 계획
          {plans && <span className="ml-2 text-base font-normal text-muted">{plans.length}개</span>}
        </h2>

        {loadError ? (
          <div role="alert" className="rounded-md border border-line bg-surface p-5">
            <p className="text-danger">{loadError}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-background"
            >
              다시 불러오기
            </button>
          </div>
        ) : plans === null ? (
          <p className="text-muted" aria-live="polite">
            불러오는 중…
          </p>
        ) : plans.length === 0 ? (
          <div className="rounded-md border border-dashed border-line p-8">
            <p className="font-medium">아직 계획이 없습니다.</p>
            <p className="mt-1 text-muted">
              &lsquo;새 계획&rsquo; 양식에 제목을 적고 &lsquo;계획 만들기&rsquo;를 눌러 첫 계획을 시작하세요.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {plans.map((plan) => {
              const period = formatPeriod(plan.start_date, plan.end_date);

              return (
                <li
                  key={plan.id}
                  className={`border-l-4 px-5 py-4 ${PRIORITY_RULE[plan.priority]}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="text-lg font-semibold break-words">
                      <Link href={`/plans/${plan.id}`} className="hover:underline">
                        {plan.title}
                      </Link>
                    </h3>
                    <span className="text-sm text-muted">
                      우선순위 {PRIORITY_LABEL[plan.priority]}
                    </span>
                  </div>

                  {plan.description && (
                    <p className="mt-1 line-clamp-2 text-muted break-words">{plan.description}</p>
                  )}

                  <p className="mt-2 text-sm text-muted tabular-nums">
                    예상 {formatMinutes(plan.estimated_minutes)}
                    {period && <span className="ml-3">{period}</span>}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-plan-heading" className="lg:sticky lg:top-6">
        <h2 id="new-plan-heading" className="mb-4 text-xl font-semibold">
          새 계획
        </h2>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-md border border-line bg-surface p-5"
        >
          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-medium">
              제목 <span className="text-muted font-normal">(필수)</span>
            </label>
            <input
              id="title"
              ref={titleRef}
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              className="w-full rounded-md border border-line bg-background px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="description" className="mb-1 block text-sm font-medium">
              설명
            </label>
            <textarea
              id="description"
              rows={3}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              className="w-full rounded-md border border-line bg-background px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="start_date" className="mb-1 block text-sm font-medium">
                시작일
              </label>
              <input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) => update("start_date", e.target.value)}
                className="w-full rounded-md border border-line bg-background px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="end_date" className="mb-1 block text-sm font-medium">
                종료일
              </label>
              <input
                id="end_date"
                type="date"
                value={form.end_date}
                min={form.start_date || undefined}
                onChange={(e) => update("end_date", e.target.value)}
                className="w-full rounded-md border border-line bg-background px-3 py-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="priority" className="mb-1 block text-sm font-medium">
                우선순위
              </label>
              <select
                id="priority"
                value={form.priority}
                onChange={(e) => update("priority", e.target.value as Priority)}
                className="w-full rounded-md border border-line bg-background px-3 py-2"
              >
                <option value="high">높음</option>
                <option value="medium">보통</option>
                <option value="low">낮음</option>
              </select>
            </div>
            <div>
              <label htmlFor="estimated_minutes" className="mb-1 block text-sm font-medium">
                예상 시간(분)
              </label>
              <input
                id="estimated_minutes"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={form.estimated_minutes}
                onChange={(e) => update("estimated_minutes", e.target.value)}
                className="w-full rounded-md border border-line bg-background px-3 py-2 tabular-nums"
              />
            </div>
          </div>

          <div>
            <label htmlFor="success_criteria" className="mb-1 block text-sm font-medium">
              성공 기준
            </label>
            <textarea
              id="success_criteria"
              rows={2}
              value={form.success_criteria}
              onChange={(e) => update("success_criteria", e.target.value)}
              className="w-full rounded-md border border-line bg-background px-3 py-2"
            />
          </div>

          {formError && (
            <p role="alert" className="whitespace-pre-line text-sm text-danger">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || form.title.trim() === ""}
            className="w-full rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink transition-opacity disabled:opacity-50"
          >
            {submitting ? "만드는 중…" : "계획 만들기"}
          </button>

          <p aria-live="polite" className="min-h-5 text-sm text-muted">
            {created}
          </p>
        </form>
      </section>
    </div>
  );
}
