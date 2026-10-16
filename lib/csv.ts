// CSV 만들기. (RFC 4180 + 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다.)

export type CsvCell = string | number | null | undefined;

// 엑셀·구글 시트는 =, +, -, @ 로 시작하는 문자열을 "수식"으로 실행한다.
// 제목이나 설명에 누군가 "=HYPERLINK(...)" 같은 값을 넣으면 내보낸 파일을 여는 사람의 프로그램에서 실행될 수 있어서
// (CSV 수식 주입), 이런 문자열 앞에는 작은따옴표(')를 붙여 일반 글자로 보이게 한다.
// 숫자(number)는 대상이 아니라서 음수도 그대로 나간다.
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) {
    return "";
  }

  let text = typeof cell === "number" ? String(cell) : cell;

  if (typeof cell === "string" && FORMULA_START.test(text)) {
    text = `'${text}`;
  }

  // 쉼표, 큰따옴표, 줄바꿈이 있으면 큰따옴표로 감싸고, 안의 큰따옴표는 두 번 쓴다.
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function toCsv(columns: readonly string[], rows: CsvCell[][]): string {
  const lines = [columns, ...rows].map((row) => row.map(escapeCell).join(","));

  // BOM(﻿) + 줄 끝은 CRLF
  return "﻿" + lines.join("\r\n") + "\r\n";
}
