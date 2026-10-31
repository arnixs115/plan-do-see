"use client";

import { useEffect } from "react";

// 로그인한 화면에서 로그아웃한 뒤 브라우저 "뒤로 가기"를 누르면, 브라우저가 이전 화면을 메모리(bfcache)에서 그대로 되살릴 수 있다.
// 그러면 서버 확인 없이 비공개 화면이 다시 보이므로, 되살려진 경우(persisted)에는 다시 불러와 서버가 로그인을 확인하게 한다.
// (서버는 로그아웃 후 이 주소에 로그인 화면으로 보내거나 비공개 항목을 주지 않는다. 이 컴포넌트는 그 확인을 거치게 만들 뿐이다.)
export default function BackForwardGuard() {
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        window.location.reload();
      }
    }

    window.addEventListener("pageshow", onPageShow);

    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return null;
}
