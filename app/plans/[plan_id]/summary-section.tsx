"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatDuration, formatMinutes } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/labels";
import type { PlanSummary } from "@/lib/types";
import ExportLinks from "@/app/export-links";
import { secondaryButton } from "@/app/ui-classes";

// 계획 대비 실제 결과(See): 완료율, 예상 시간 대비 실제 작업 시간, 할 일별 비교, CSV 내려받기
export default function SummarySection({
  planId,
  refreshKey,
}: {
  planId: string;
  refreshKey: number;
}) {
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    api<PlanSummary>(`/api/plans/${planId}/summary`)
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "결과를 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, [planId, refreshKey, retryKey]);

  return (
    <section aria-labelledby="summary-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="summary-heading" className="text-xl font-semibold">
          결과
        </h2>
        <ExportLinks basePath={`/api/plans/${planId}/export`} scope="이 계획" />
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-md border border-line bg-surface p-4">
          <p className="text-danger">{error}</p>
          <button
            type="button"
            onClick={() => setRetryKey((key) => key + 1)}
            className={`mt-3 ${secondaryButton}`}
          >
            다시 불러오기
          </button>
        </div>
      )}

      {!summary ? (
        !error && (
          <p className="text-muted" aria-live="polite">
            불러오는 중…
          </p>
        )
      ) : (
        <SummaryBody summary={summary} />
      )}
    </section>
  );
}

function SummaryBody({ summary }: { summary: PlanSummary }) {
  const { todo_counts: counts, actual } = summary;
  const percent = summary.completion_rate === null ? null : Math.round(summary.completion_rate * 100);
  const estimated = summary.estimated_minutes;

  // 예상 시간은 분, 실제 작업 시간은 초로 받으므로 같은 단위(분)로 맞춰 차이를 계산한다.
  const actualMinutes = actual.work_seconds / 60;
  const diff = estimated.todos > 0 ? Math.round(actualMinutes - estimated.todos) : null;

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium">완료율</p>
          <p className="tabular-nums text-muted">
            {percent === null ? "할 일 없음" : `${percent}% (${counts.completed} / ${counts.total})`}
          </p>
        </div>

        <div
          role="progressbar"
          aria-label="완료율"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? 0}
          className="mt-2 h-2 overflow-hidden rounded-full bg-background"
        >
          <div className="h-full bg-accent" style={{ width: `${percent ?? 0}%` }} />
        </div>

        <p className="mt-2 text-sm text-muted tabular-nums">
          시작 전 {counts.todo} · 진행 중 {counts.in_progress} · 완료 {counts.completed}
        </p>
      </div>

      <dl className="grid gap-x-8 gap-y-3 rounded-md border border-line bg-surface p-5 text-sm sm:grid-cols-2">
        <Stat label="계획 예상 시간" value={formatMinutes(estimated.plan)} />
        <Stat label="할 일 예상 시간 합계" value={formatMinutes(estimated.todos)} />
        <Stat
          label="실제 작업 시간"
          value={formatDuration(actual.work_seconds)}
          note={
            actual.active_execution_count > 0
              ? `진행 중인 실행 ${actual.active_execution_count}개 포함`
              : undefined
          }
        />
        <Stat
          label="실행 횟수"
          value={`${actual.execution_count}회`}
        />
        {diff !== null && (
          <Stat
            label="할 일 예상 대비"
            value={diff === 0 ? "예상과 같음" : diff > 0 ? `${formatMinutes(diff)} 초과` : `${formatMinutes(-diff)} 절약`}
          />
        )}
        <Stat label="수정 이력" value={`${summary.revision_count}회`} />
      </dl>

      {summary.todos.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <caption className="sr-only">할 일별 예상 시간과 실제 작업 시간</caption>
            <thead className="border-b border-line text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">할 일</th>
                <th scope="col" className="px-4 py-2 font-medium">상태</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">예상</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">실제</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">횟수</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {summary.todos.map((todo) => (
                <tr key={todo.id}>
                  <th scope="row" className="px-4 py-2 font-normal break-words">{todo.title}</th>
                  <td className="px-4 py-2">{STATUS_LABEL[todo.status]}</td>
                  <td className="px-4 py-2 text-right">
                    {todo.estimated_minutes > 0 ? formatMinutes(todo.estimated_minutes) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {todo.work_seconds > 0 ? formatDuration(todo.work_seconds) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">{todo.execution_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>
        {value}
        {note && <span className="ml-2 text-muted">({note})</span>}
      </dd>
    </div>
  );
}
