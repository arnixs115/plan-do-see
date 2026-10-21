"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, formatDuration, formatMinutes } from "@/lib/format";
import { PRIORITY_LABEL, STATUS_LABEL, STATUSES } from "@/lib/labels";
import type { ExecutionResult, LiveExecution, Todo, TodoStatus, TodoView } from "@/lib/types";
import { dangerButton, inputClass, secondaryButton } from "@/app/ui-classes";
import ExecutionControls from "./execution-controls";
import TodoForm from "./todo-form";

// API가 준 할 일에 "화면용 진행 중 실행(받은 시각 포함)"을 붙인다.
function toView(todo: Todo): TodoView {
  const { active_execution, ...rest } = todo;

  return {
    ...rest,
    live: active_execution ? { ...active_execution, receivedAt: Date.now() } : null,
  };
}

// 실행 API 결과 → 화면용 진행 중 실행 (끝났으면 null)
function toLive(result: ExecutionResult): LiveExecution | null {
  if (result.status === "ended") return null;

  return {
    id: result.execution.id,
    status: result.status,
    work_seconds: result.work_seconds,
    receivedAt: Date.now(),
  };
}

export default function TodoSection({ planId }: { planId: string }) {
  const [todos, setTodos] = useState<TodoView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [rowNotice, setRowNotice] = useState<{ id: string; message: string } | null>(null);

  // 같은 시작 요청을 다시 보낼 때(더블 클릭, 재시도) 같은 키를 쓰려고 성공할 때까지 보관한다.
  const startKeys = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;

    api<Todo[]>(`/api/plans/${planId}/todos`)
      .then((data) => {
        if (!cancelled) setTodos(data.map(toView));
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

  // 수정 응답에는 active_execution이 없으므로, 기존 화면 값(live)은 그대로 두고 나머지만 덮어쓴다.
  function replaceTodo(updated: Todo) {
    const { active_execution: _ignored, ...fields } = updated;
    void _ignored;

    setTodos((prev) => prev?.map((t) => (t.id === updated.id ? { ...t, ...fields } : t)) ?? prev);
  }

  function setLive(id: string, live: LiveExecution | null) {
    setTodos((prev) => prev?.map((t) => (t.id === id ? { ...t, live } : t)) ?? prev);
  }

  async function createTodo(body: Record<string, unknown>) {
    const todo = await api<Todo>(`/api/plans/${planId}/todos`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    setTodos((prev) => [...(prev ?? []), toView(todo)]);
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

  // 실행 동작 하나를 수행하는 공통 틀: 처리 중 표시, 오류 표시
  async function runExecution(id: string, action: () => Promise<void>) {
    setBusyId(id);
    setRowError(null);
    setRowNotice(null);

    try {
      await action();
    } catch (e) {
      setRowError({ id, message: e instanceof ApiError ? e.message : "요청을 처리하지 못했습니다." });

      // 이미 진행 중이었던 경우 등, 화면이 서버와 어긋났을 수 있으니 다시 불러온다.
      if (e instanceof ApiError && e.status === 409) setReloadKey((key) => key + 1);
    } finally {
      setBusyId(null);
    }
  }

  function startExecution(id: string) {
    return runExecution(id, async () => {
      const key = startKeys.current.get(id) ?? crypto.randomUUID();
      startKeys.current.set(id, key);

      const result = await api<ExecutionResult>(`/api/todos/${id}/executions`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });

      startKeys.current.delete(id);
      setLive(id, toLive(result));
      // 시작하면 할 일 상태가 '진행 중'으로 바뀌므로 서버의 값으로 다시 불러온다.
      setReloadKey((k) => k + 1);
    });
  }

  function stepExecution(todo: TodoView, step: "pause" | "resume") {
    return runExecution(todo.id, async () => {
      if (!todo.live) return;

      const result = await api<ExecutionResult>(`/api/executions/${todo.live.id}/${step}`, {
        method: "POST",
      });

      setLive(todo.id, toLive(result));
    });
  }

  function endExecution(todo: TodoView, blockerReason: string) {
    return runExecution(todo.id, async () => {
      if (!todo.live) return;

      const body = blockerReason.trim() ? JSON.stringify({ blocker_reason: blockerReason }) : undefined;

      const result = await api<ExecutionResult>(`/api/executions/${todo.live.id}/end`, {
        method: "POST",
        body,
      });

      setLive(todo.id, null);
      setRowNotice({
        id: todo.id,
        message: `실행을 종료했습니다. 이번 작업 시간은 ${formatDuration(result.work_seconds)}입니다.`,
      });
      // 종료하면 할 일 상태가 '완료'로 바뀌므로 서버의 값으로 다시 불러온다.
      setReloadKey((k) => k + 1);
    });
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
                  notice={rowNotice?.id === todo.id ? rowNotice.message : null}
                  onStart={() => startExecution(todo.id)}
                  onPause={() => stepExecution(todo, "pause")}
                  onResume={() => stepExecution(todo, "resume")}
                  onEnd={(blocker) => endExecution(todo, blocker)}
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
  todo: TodoView;
  busy: boolean;
  confirming: boolean;
  error: string | null;
  notice: string | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: (blockerReason: string) => void;
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
  notice,
  onStart,
  onPause,
  onResume,
  onEnd,
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

      {notice && (
        <p aria-live="polite" className="mt-2 text-sm text-muted">
          {notice}
        </p>
      )}

      <ExecutionControls
        todo={todo}
        busy={busy}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onEnd={onEnd}
      />

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
