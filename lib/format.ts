// 화면에 보여 줄 값을 다듬는 함수들

// 분 → "45분", "2시간", "1시간 30분"
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

// "2026-10-20" → "2026.10.20"
// (Date 객체로 바꾸면 시간대 때문에 하루가 밀릴 수 있어서 문자열 그대로 다룬다)
export function formatDate(date: string): string {
  return date.replaceAll("-", ".");
}

// 시작일·종료일 중 있는 것만 이어서 보여 준다.
export function formatPeriod(start: string | null, end: string | null): string | null {
  if (start && end) return `${formatDate(start)} ~ ${formatDate(end)}`;
  if (start) return `${formatDate(start)} 시작`;
  if (end) return `${formatDate(end)}까지`;
  return null;
}

// 초 → 타이머 표기: "04:07", "1:02:03"
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// 초 → 읽기 쉬운 길이: "45초", "12분 30초", "1시간 2분"
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  if (m > 0) return s > 0 ? `${m}분 ${s}초` : `${m}분`;
  return `${s}초`;
}
