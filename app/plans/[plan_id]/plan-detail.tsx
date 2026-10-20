"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatMinutes, formatPeriod, formatDate } from "@/lib/format";
import { PRIORITY_LABEL } from "@/lib/labels";
import type { Plan } from "@/lib/types";
import { secondaryButton } from "@/app/ui-classes";
import PlanEditForm from "./plan-edit-form";
import TodoSection from "./todo-section";

type LoadError = { message: string; status: number };

export default function PlanDetail({ planId }: { planId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api<Plan>(`/api/plans/${planId}`)
      .then((data) => {
        if (!cancelled) setPlan(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError
            ? { message: e.message, status: e.status }
            : { message: "계획을 불러오지 못했습니다.", status: 0 }
        );
      });

    return () => {
      cancelled = true;
    };
  }, [planId, reloadKey]);

  function retry() {
    setError(null);
    setReloadKey((key) => key + 1);
  }

  if (error) {
    return (
      <div role="alert" className="mt-6 rounded-md border border-line bg-surface p-5">
        <p className="font-medium">
          {error.status === 404 ? "계획을 찾을 수 없습니다." : error.message}
        </p>
        {error.status === 404 ? (
          <p className="mt-1 text-muted">삭제되었거나 주소가 잘못되었을 수 있습니다.</p>
        ) : (
          <button type="button" onClick={retry} className={`mt-3 ${secondaryButton}`}>
            다시 불러오기
          </button>
        )}
      </div>
    );
  }

  if (!plan) {
    return (
      <p className="mt-6 text-muted" aria-live="polite">
        불러오는 중…
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-10">
      <section aria-labelledby="plan-title">
        {editing ? (
          <PlanEditForm
            plan={plan}
            onCancel={() => setEditing(false)}
            onSaved={(updated, revisionNo) => {
              setPlan(updated);
              setEditing(false);
              setNotice(`수정했습니다. 이전 내용은 수정 이력 ${revisionNo}번으로 보존되었습니다.`);
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 id="plan-title" className="text-3xl font-bold tracking-tight break-words">
                {plan.title}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setEditing(true);
                }}
                className={secondaryButton}
              >
                계획 수정
              </button>
            </div>

            {notice && (
              <p aria-live="polite" className="mt-2 text-sm text-muted">
                {notice}
              </p>
            )}

            {plan.description && (
              <p className="mt-3 whitespace-pre-line text-muted break-words">{plan.description}</p>
            )}

            <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="우선순위" value={PRIORITY_LABEL[plan.priority]} />
              <Item label="예상 시간" value={formatMinutes(plan.estimated_minutes)} />
              <Item label="기간" value={formatPeriod(plan.start_date, plan.end_date)} />
              <Item
                label="목표일"
                value={plan.target_date ? formatDate(plan.target_date) : null}
              />
              <Item label="성공 기준" value={plan.success_criteria} wide />
              <Item label="다음 계획 메모" value={plan.next_plan_note} wide />
            </dl>
          </>
        )}
      </section>

      <TodoSection planId={planId} />
    </div>
  );
}

function Item({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted">{label}</dt>
      <dd className="whitespace-pre-line break-words">{value ? value : "—"}</dd>
    </div>
  );
}
