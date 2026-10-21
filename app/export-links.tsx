// CSV 내려받기 링크. 서버가 Content-Disposition: attachment로 응답하므로 누르면 파일로 저장된다.
// (브라우저가 직접 받는 링크라서 fetch 없이 <a>만 쓴다)

import { secondaryButton } from "@/app/ui-classes";

export default function ExportLinks({ basePath, scope }: { basePath: string; scope: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`${basePath}?type=todos`} download className={secondaryButton}>
        {scope} 할 일 CSV
      </a>
      <a href={`${basePath}?type=executions`} download className={secondaryButton}>
        {scope} 실행 기록 CSV
      </a>
    </div>
  );
}
