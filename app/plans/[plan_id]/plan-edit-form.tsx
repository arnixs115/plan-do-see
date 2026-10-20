"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { emptyToNull } from "@/lib/form";
import { PRIORITY_LABEL } from "@/lib/labels";
import type { Plan, Priority } from "@/lib/types";
import { inputClass, primaryButton, secondaryButton } from "@/app/ui-classes";

type Props = {
  plan: Plan;
  onSaved: (plan: Plan, revisionNo: number) => void;
  onCancel: () => void;
};

type PatchResult = { message: string; revision_no: number; data: Plan };

export default function PlanEditForm({ plan, onSaved, onCancel }: Props) {
  const [form, setForm] = useState({
    title: plan.title,
    description: plan.description,
    priority: plan.priority,
    start_date: plan.start_date ?? "",
    end_date: plan.end_date ?? "",
    target_date: plan.target_date ?? "",
    estimated_minutes: String(plan.estimated_minutes),
    success_criteria: plan.success_criteria,
    next_plan_note: plan.next_plan_note,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // 바뀐 칸만 모아서 보낸다. (바뀐 게 없으면 요청 자체를 보내지 않는다)
  function changes() {
    const body: Record<string, unknown> = {};

    for (const key of ["title", "description", "success_criteria", "next_plan_note"] as const) {
      if (form[key] !== plan[key]) body[key] = form[key];
    }

    if (form.priority !== plan.priority) body.priority = form.priority;

    for (const key of ["start_date", "end_date", "target_date"] as const) {
      const next = emptyToNull(form[key]);
      if (next !== plan[key]) body[key] = next;
    }

    const minutes = form.estimated_minutes.trim() === "" ? 0 : Number(form.estimated_minutes);
    if (minutes !== plan.estimated_minutes) body.estimated_minutes = minutes;

    return body;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) return;

    const body = changes();

    if (Object.keys(body).length === 0) {
      setError("바뀐 내용이 없습니다.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = await api<PatchResult>(`/api/plans/${plan.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      onSaved(result.data, result.revision_no);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "계획을 수정하지 못했습니다.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-line bg-surface p-5">
      <h2 className="text-xl font-semibold">계획 수정</h2>

      <Field label="제목" htmlFor="e-title">
        <input
          id="e-title"
          required
          maxLength={200}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="설명" htmlFor="e-description">
        <textarea
          id="e-description"
          rows={3}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="시작일" htmlFor="e-start">
          <input
            id="e-start"
            type="date"
            value={form.start_date}
            onChange={(e) => set("start_date", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="종료일" htmlFor="e-end">
          <input
            id="e-end"
            type="date"
            value={form.end_date}
            min={form.start_date || undefined}
            onChange={(e) => set("end_date", e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="목표일" htmlFor="e-target">
          <input
            id="e-target"
            type="date"
            value={form.target_date}
            onChange={(e) => set("target_date", e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="우선순위" htmlFor="e-priority">
          <select
            id="e-priority"
            value={form.priority}
            onChange={(e) => set("priority", e.target.value as Priority)}
            className={inputClass}
          >
            {(["high", "medium", "low"] as const).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="예상 시간(분)" htmlFor="e-minutes">
          <input
            id="e-minutes"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={form.estimated_minutes}
            onChange={(e) => set("estimated_minutes", e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
      </div>

      <Field label="성공 기준" htmlFor="e-criteria">
        <textarea
          id="e-criteria"
          rows={2}
          value={form.success_criteria}
          onChange={(e) => set("success_criteria", e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="다음 계획 메모" htmlFor="e-next">
        <textarea
          id="e-next"
          rows={2}
          value={form.next_plan_note}
          onChange={(e) => set("next_plan_note", e.target.value)}
          className={inputClass}
        />
      </Field>

      {error && (
        <p role="alert" className="whitespace-pre-line text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={saving || form.title.trim() === ""} className={primaryButton}>
          {saving ? "저장 중…" : "수정 저장"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={secondaryButton}>
          취소
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
