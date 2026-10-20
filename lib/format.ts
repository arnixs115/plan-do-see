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
