"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, formatMinutes } from "@/lib/format";
import { PRIORITY_LABEL, STATUS_LABEL, STATUSES } from "@/lib/labels";
import type { Todo, TodoStatus } from "@/lib/types";
import { dangerButton, inputClass, secondaryButton } from "@/app/ui-classes";
import TodoForm from "./todo-form";

export default function TodoSection({ planId }: { planId: string }) {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    api<Todo[]>(`/api/plans/${planId}/todos`)
      .then((data) => {
        if (!cancelled) setTodos(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof ApiError ? e.message : "할 일을 불러오지 못했습니다.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [planId, reloadKey]);

  function retry() {
    setLoadError(null);
    setReloadKey((key) => key + 1);
  }

  function replaceTodo(updated: Todo) {
    setTodos((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev);
  }

  async function createTodo(body: Record<string, unknown>) {
    const todo = await api<Todo>(`/api/plans/${planId}/todos`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    setTodos((prev) => [...(prev ?? []), todo]);
  }

  async function updateTodo(id: string, body: Record<string, unknown>) {
    const todo = await api<Todo>(`/api/todos/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    replaceTodo(todo);
  }

  async function changeStatus(id: string, status: TodoStatus) {
    setBusyId(id);
    setRowError(null);

    try {
      await updateTodo(id, { status });
    } catch (e) {
      setRowError({ id, message: e instanceof ApiError ? e.message : "상태를 바꾸지 못했습니다." });
    } finally {
      setBusyId(null);
    }
  }

  async function removeTodo(id: string) {
    setBusyId(id);
    setRowError(null);

    try {
      await api<void>(`/api/todos/${id}`, { method: "DELETE" });
      setTodos((prev) => prev?.filter((t) => t.id !== id) ?? prev);
      setConfirmingId(null);
    } catch (e) {
      setRowError({ id, message: e instanceof ApiError ? e.message : "삭제하지 못했습니다." });
    } finally {
      setBusyId(null);
    }
  }

  const done = todos?.filter((t) => t.status === "completed").length ?? 0;

  return (
    <section aria-labelledby="todos-heading">
      <h2 id="todos-heading" className="mb-4 text-xl font-semibold">
        할 일
        {todos && todos.length > 0 && (
          <span className="ml-2 text-base font-normal text-muted tabular-nums">
            완료 {done} / {todos.length}
          </span>
        )}
      </h2>

      {loadError ? (
        <div role="alert" className="rounded-md border border-line bg-surface p-5">
          <p className="text-danger">{loadError}</p>
          <button type="button" onClick={retry} className={`mt-3 ${secondaryButton}`}>
            다시 불러오기
          </button>
        </div>
      ) : todos === null ? (
        <p className="text-muted" aria-live="polite">
          불러오는 중…
        </p>
      ) : todos.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-6 text-muted">
          아직 할 일이 없습니다. 아래 양식으로 첫 할 일을 추가하세요.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
          {todos.map((todo) => (
            <li key={todo.id} className="px-5 py-4">
              {editingId === todo.id ? (
                <TodoForm
                  initial={todo}
                  submitLabel="수정 저장"
                  onSubmit={async (body) => {
                    await updateTodo(todo.id, body);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <TodoRow
                  todo={todo}
                  busy={busyId === todo.id}
                  confirming={confirmingId === todo.id}
                  error={rowError?.id === todo.id ? rowError.message : null}
                  onStatus={(status) => changeStatus(todo.id, status)}
                  onEdit={() => {
                    setConfirmingId(null);
                    setEditingId(todo.id);
                  }}
                  onAskDelete={() => setConfirmingId(todo.id)}
                  onCancelDelete={() => setConfirmingId(null)}
                  onDelete={() => removeTodo(todo.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {todos !== null && !loadError && (
        <div className="mt-6 rounded-md border border-line bg-surface p-5">
          <h3 className="mb-3 font-semibold">할 일 추가</h3>
          <TodoForm submitLabel="추가" onSubmit={createTodo} />
        </div>
      )}
    </section>
  );
}

type RowProps = {
  todo: Todo;
  busy: boolean;
  confirming: boolean;
  error: string | null;
  onStatus: (status: TodoStatus) => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
};

function TodoRow({
  todo,
  busy,
  confirming,
  error,
  onStatus,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: RowProps) {
  const completed = todo.status === "completed";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={`font-semibold break-words ${completed ? "text-muted line-through" : ""}`}>
            {todo.title}
          </p>

          {todo.description && (
            <p className="mt-1 whitespace-pre-line text-muted break-words">{todo.description}</p>
          )}

          <p className="mt-2 text-sm text-muted tabular-nums">
            우선순위 {PRIORITY_LABEL[todo.priority]}
            {todo.estimated_minutes > 0 && (
              <span className="ml-3">예상 {formatMinutes(todo.estimated_minutes)}</span>
            )}
            {todo.due_date && <span className="ml-3">마감 {formatDate(todo.due_date)}</span>}
          </p>

          {todo.tags.length > 0 && (
            <p className="mt-1 text-sm text-muted break-words">
              {todo.tags.map((tag) => `#${tag}`).join(" ")}
            </p>
          )}
        </div>

        <label className="text-sm">
          <span className="sr-only">{todo.title} 상태</span>
          <select
            value={todo.status}
            disabled={busy}
            onChange={(e) => onStatus(e.target.value as TodoStatus)}
            className={`${inputClass} w-auto py-1.5`}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm">이 할 일을 삭제할까요?</span>
            <button type="button" onClick={onDelete} disabled={busy} className={dangerButton}>
              {busy ? "삭제 중…" : "삭제"}
            </button>
            <button type="button" onClick={onCancelDelete} disabled={busy} className={secondaryButton}>
              취소
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onEdit} disabled={busy} className={secondaryButton}>
              수정
            </button>
            <button type="button" onClick={onAskDelete} disabled={busy} className={secondaryButton}>
              삭제
            </button>
          </>
        )}
      </div>
    </div>
  );
}
