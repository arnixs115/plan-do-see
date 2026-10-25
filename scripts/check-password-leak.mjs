// 비밀번호 원문이 서버 로그·네트워크 기록에 남았는지 검사한다. (읽기 전용, 파일만 읽는다)
//
// 사용법 (비밀번호는 명령줄 인자가 아니라 환경변수로 준다. 시험용 비밀번호만 쓴다)
//   TEST_PASSWORD='<시험 계정 비밀번호>' node scripts/check-password-leak.mjs --har 기록.har --log dev-server.log
//
//   --har <파일>  브라우저 개발자 도구(Network → Export HAR)로 저장한 파일. 여러 번 줄 수 있다.
//   --log <파일>  서버 터미널 출력을 저장한 파일. 여러 번 줄 수 있다.
//                 (예: npm run dev 2>&1 | tee dev-server.log)
//
// 무엇을 보나
//   * HAR: 아래 칸마다 비밀번호가 들어 있는지 센다.
//       - 요청 본문(POST 내용): 로그인·가입 요청에는 **있어야 정상**이다. 개수만 알려 준다.
//       - 그 밖의 모든 칸(요청 주소, 요청 헤더·쿠키, 응답 헤더·쿠키·본문): **0이어야** 한다.
//   * 로그 파일: 비밀번호가 들어 있는 줄이 있으면 실패다. (줄 번호만 알려 준다)
//   * 원문뿐 아니라 주소 인코딩, JSON 이스케이프, base64 형태도 찾는다.
//     쿠키 값은 `base64-` 접두사(@supabase/ssr 쿠키 형식)와 base64url 을 풀어서도 찾는다.
//
// 출력에는 비밀번호도, 찾은 줄의 내용도 찍지 않는다. 위치(요청 번호·칸 이름·줄 번호)와 개수만 찍는다.
// 종료 코드: 0 = 금지된 칸에서 발견되지 않음, 1 = 발견됨, 2 = 사용법 오류

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const MIN_LENGTH = 8;

export function variantsOf(password) {
  const set = new Set([password]);
  set.add(encodeURIComponent(password));
  set.add(JSON.stringify(password).slice(1, -1));
  set.add(Buffer.from(password, "utf8").toString("base64"));
  set.add(Buffer.from(password, "utf8").toString("base64url"));
  return [...set].filter((value) => value.length > 0);
}

// 값 하나에 비밀번호(또는 그 인코딩)가 들어 있는지. 쿠키처럼 base64로 감싼 값은 풀어서도 본다.
export function containsPassword(text, variants) {
  if (typeof text !== "string" || text.length === 0) return false;

  const candidates = [text];

  try {
    candidates.push(decodeURIComponent(text));
  } catch {
    // 주소 인코딩이 아닌 값
  }

  for (const candidate of [...candidates]) {
    const stripped = candidate.startsWith("base64-") ? candidate.slice(7) : candidate;

    for (const encoding of ["base64url", "base64"]) {
      try {
        const decoded = Buffer.from(stripped, encoding).toString("utf8");

        if (decoded.length > 0) candidates.push(decoded);
      } catch {
        // 풀 수 없는 값
      }
    }
  }

  return candidates.some((candidate) => variants.some((variant) => candidate.includes(variant)));
}

function pairText(list) {
  return (list ?? []).map((item) => `${item.name}: ${item.value}`).join("\n");
}

// 쿠키는 값 하나하나를 따로 본다. (값이 `base64-...` 로 시작해야 풀어서 볼 수 있다)
function cookieValues(list) {
  return (list ?? []).map((item) => item.value);
}

function responseBody(response) {
  const content = response?.content;

  if (!content?.text) return "";

  return content.encoding === "base64"
    ? Buffer.from(content.text, "base64").toString("utf8")
    : content.text;
}

// HAR 한 개를 검사한다. 칸별 발견 개수를 돌려준다.
export function scanHar(har, variants) {
  const entries = har?.log?.entries ?? [];
  const forbidden = [];
  let requestBodyHits = 0;

  entries.forEach((entry, index) => {
    const label = `#${index + 1} ${entry.request?.method ?? "?"} ${(() => {
      try {
        return new URL(entry.request.url).pathname;
      } catch {
        return "?";
      }
    })()}`;

    const fields = {
      "요청 주소": entry.request?.url,
      "요청 헤더": pairText(entry.request?.headers),
      "요청 쿠키": cookieValues(entry.request?.cookies),
      "요청 쿼리": pairText(entry.request?.queryString),
      "응답 헤더": pairText(entry.response?.headers),
      "응답 쿠키": cookieValues(entry.response?.cookies),
      "응답 본문": responseBody(entry.response),
    };

    for (const [field, value] of Object.entries(fields)) {
      const values = Array.isArray(value) ? value : [value];

      if (values.some((text) => containsPassword(text, variants))) forbidden.push({ where: label, field });
    }

    const body = entry.request?.postData;
    const bodyText = [body?.text, ...(body?.params ?? []).map((p) => p.value)].filter(Boolean).join("\n");

    if (containsPassword(bodyText, variants)) requestBodyHits += 1;
  });

  return { entryCount: entries.length, requestBodyHits, forbidden };
}

// 로그 텍스트에서 비밀번호가 들어 있는 줄 번호
export function scanLog(text, variants) {
  const lines = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (containsPassword(line, variants)) lines.push(index + 1);
  });

  return lines;
}

function parseArgs(argv) {
  const hars = [];
  const logs = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--har" && argv[i + 1]) hars.push(argv[++i]);
    else if (argv[i] === "--log" && argv[i + 1]) logs.push(argv[++i]);
    else return null;
  }

  return hars.length + logs.length > 0 ? { hars, logs } : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const password = process.env.TEST_PASSWORD;

  if (!args || !password) {
    console.log("사용법: TEST_PASSWORD='<시험 비밀번호>' node scripts/check-password-leak.mjs --har 기록.har --log 서버로그.txt");
    console.log("        (비밀번호는 환경변수로만 받고, 출력에는 절대 찍지 않습니다)");
    process.exit(2);
  }

  if ([...password].length < MIN_LENGTH) {
    console.log(`TEST_PASSWORD 가 너무 짧습니다. (${MIN_LENGTH}자 이상) 짧으면 우연히 일치해 거짓 발견이 생깁니다.`);
    process.exit(2);
  }

  const variants = variantsOf(password);
  let failed = false;

  for (const file of args.hars) {
    let har;

    try {
      har = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      console.log(`ERROR  ${file}: HAR 를 읽을 수 없습니다. (${error.message})`);
      process.exit(2);
    }

    const result = scanHar(har, variants);

    console.log(`[HAR] ${file}: 요청 ${result.entryCount}개`);
    console.log(`      요청 본문에 비밀번호가 든 요청: ${result.requestBodyHits}개 (로그인·가입 요청에는 있어야 정상)`);

    if (result.forbidden.length === 0) {
      console.log("PASS  요청 주소·헤더·쿠키, 응답 헤더·쿠키·본문 어디에도 비밀번호가 없음");
    } else {
      failed = true;
      console.log(`FAIL  금지된 칸에서 비밀번호 발견 ${result.forbidden.length}건:`);
      result.forbidden.forEach((item) => console.log(`        ${item.where} → ${item.field}`));
    }

    if (result.requestBodyHits === 0) {
      console.log("NOTE  요청 본문에서도 비밀번호가 하나도 안 보입니다. 이 기록에 로그인·가입 요청이 들어 있는지, TEST_PASSWORD 가 맞는지 확인하세요. (검사가 아무것도 못 본 것일 수 있음)");
    }
  }

  for (const file of args.logs) {
    let text;

    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      console.log(`ERROR  ${file}: 읽을 수 없습니다. (${error.message})`);
      process.exit(2);
    }

    const lines = scanLog(text, variants);

    console.log(`[LOG] ${file}: ${text.split(/\r?\n/).length}줄`);

    if (lines.length === 0) {
      console.log("PASS  비밀번호가 들어 있는 줄이 없음");
    } else {
      failed = true;
      console.log(`FAIL  비밀번호가 들어 있는 줄 ${lines.length}개 (줄 번호: ${lines.slice(0, 20).join(", ")})`);
    }
  }

  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
