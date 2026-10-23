// 가입·로그인 화면의 폼 상태 (Server Action이 돌려주고 화면이 보여 준다)
export type AuthFormState = {
  error?: string;
  notice?: string;
  // 오류가 났을 때 입력했던 이메일을 다시 채우기 위한 값 (비밀번호는 절대 돌려보내지 않는다)
  email?: string;
};
