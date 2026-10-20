"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api-client";
import { emptyToNull, parseTags, tagsToText } from "@/lib/form";
import { PRIORITY_LABEL } from "@/lib/labels";
import type { Priority, Todo } from "@/lib/types";
import { inputClass, primaryButton, secondaryButton } from "@/app/ui-classes";

type Props = {
  // 있으면 수정 양식, 없으면 새 할 일 양식
  initial?: Todo;
  submitLabel: string;
  // 실패하면 throw 한다. (이 양식이 메시지를 보여 준다)
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
};

type FormState = {
  title: string;
  description: string;
  priority: Priority;
  due_date: string;
  estimated_minutes: string;
  tags: string;
};

function toFormState(todo?: Todo): FormState {
  return {
    title: todo?.title ?? "",
    description: todo?.description ?? "",
    priority: todo?.priority ?? "medium",
    due_date: todo?.due_date ?? "",
    estimated_minutes: todo ? String(todo.estimated_minutes) : "",
    tags: todo ? tagsToText(todo.tags) : "",
  };
}

export default function TodoForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idPrefix = initial ? `t-${initial.id}` : "t-new";

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildBody() {
    const body: Record<string, unknown> = {
      title: form.title,
      priority: form.priority,
      tags: parseTags(form.tags),
    };

    if (initial) {
      // 수정: 비운 칸도 비운 값으로 보낸다.
      body.description = form.description;
      body.due_date = emptyToNull(form.due_date);
      body.estimated_minutes = form.estimated_minutes.trim() === "" ? 0 : Number(form.estimated_minutes);
    } else {
      // 새로 만들기: 비어 있는 칸은 보내지 않아 기본값이 들어가게 한다.
      if (form.description.trim()) body.description = form.description;
      if (form.due_date) body.due_date = form.due_date;
      if (form.estimated_minutes.trim() !== "") body.estimated_minutes = Number(form.estimated_minutes);
    }

    return body;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) return;

    setSaving(true);
    setError(null);

    try {
      await onSubmit(buildBody());
      if (!initial) setForm(toFormState());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-title`} className="mb-1 block text-sm font-medium">
          할 일 제목
        </label>
        <input
          id={`${idPrefix}-title`}
          required
          maxLength={200}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${idPrefix}-priority`} className="mb-1 block text-sm font-medium">
            우선순위
          </label>
          <select
            id={`${idPrefix}-priority`}
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
        </div>
        <div>
          <label htmlFor={`${idPrefix}-due`} className="mb-1 block text-sm font-medium">
            마감일
          </label>
          <input
            id={`${idPrefix}-due`}
            type="date"
            value={form.due_date}
            onChange={(e) => set("due_date", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-minutes`} className="mb-1 block text-sm font-medium">
            예상 시간(분)
          </label>
          <input
            id={`${idPrefix}-minutes`}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={form.estimated_minutes}
            onChange={(e) => set("estimated_minutes", e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-tags`} className="mb-1 block text-sm font-medium">
          태그 <span className="font-normal text-muted">(쉼표로 구분)</span>
        </label>
        <input
          id={`${idPrefix}-tags`}
          value={form.tags}
          onChange={(e) => set("tags", e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-description`} className="mb-1 block text-sm font-medium">
          설명
        </label>
        <textarea
          id={`${idPrefix}-description`}
          rows={2}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          className={inputClass}
        />
      </div>

      {error && (
        <p role="alert" className="whitespace-pre-line text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={saving || form.title.trim() === ""} className={primaryButton}>
          {saving ? "저장 중…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className={secondaryButton}>
            취소
          </button>
        )}
      </div>
    </form>
  );
}
