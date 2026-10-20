// 입력 양식 값을 API로 보낼 값으로 바꾸는 작은 함수들

// "a, b ,, c" → ["a", "b", "c"]  (쉼표로 구분, 앞뒤 공백과 빈 태그 제거)
export function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function tagsToText(tags: string[]): string {
  return tags.join(", ");
}

// 비어 있는 날짜 칸은 null(값 비우기)로 보낸다.
export function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}
