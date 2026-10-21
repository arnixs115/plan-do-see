"use client";

import { useEffect, useState } from "react";
import { formatClock } from "@/lib/format";
import type { TodoView } from "@/lib/types";
import { inputClass, primaryButton, secondaryButton } from "@/app/ui-classes";

type Props = {
  todo: TodoView;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: (blockerReason: string) => void;
};

// 진행 중이면 1초마다 다시 그려서 흐르는 시간을 보여 준다. 일시 정지면 멈춘 값을 보여 준다.
function ElapsedClock({ live }: { live: NonNullable<TodoView["live"]> }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (live.status !== "running") return;

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [live.status]);

  const extra = live.status === "running" ? Math.max(0, (now - live.receivedAt) / 1000) : 0;

  return <span className="font-semibold tabular-nums">{formatClock(live.work_seconds + extra)}</span>;
}

export default function ExecutionControls({ todo, busy, onStart, onPause, onResume, onEnd }: Props) {
  const [ending, setEnding] = useState(false);
  const [blocker, setBlocker] = useState("");
  const live = todo.live;

  if (ending && live) {
    return (
      <div className="mt-3 space-y-2 rounded-md border border-line p-3">
        <p className="text-sm">
          실행을 종료하면 이 할 일이 <strong>완료</strong>로 바뀝니다.
        </p>
        <label className="block text-sm font-medium" htmlFor={`blocker-${todo.id}`}>
          막힌 점이나 메모 <span className="font-normal text-muted">(선택)</span>
        </label>
        <textarea
          id={`blocker-${todo.id}`}
          rows={2}
          value={blocker}
          onChange={(e) => setBlocker(e.target.value)}
          className={inputClass}
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onEnd(blocker);
              setEnding(false);
              setBlocker("");
            }}
            className={primaryButton}
          >
            {busy ? "종료 중…" : "실행 종료"}
          </button>
          <button type="button" disabled={busy} onClick={() => setEnding(false)} className={secondaryButton}>
            취소
          </button>
        </div>
      </div>
    );
  }

  if (!live) {
    return (
      <div className="mt-3">
        <button type="button" disabled={busy} onClick={onStart} className={secondaryButton}>
          {busy ? "시작 중…" : todo.status === "completed" ? "다시 시작" : "실행 시작"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">{live.status === "running" ? "진행 중" : "일시정지"}</span>
      <ElapsedClock key={live.receivedAt} live={live} />

      {live.status === "running" ? (
        <button type="button" disabled={busy} onClick={onPause} className={secondaryButton}>
          일시정지
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={onResume} className={secondaryButton}>
          재개
        </button>
      )}

      <button type="button" disabled={busy} onClick={() => setEnding(true)} className={secondaryButton}>
        종료
      </button>
    </div>
  );
}
