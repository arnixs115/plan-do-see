# 계정 간 데이터 격리 (과제 8 카드 5)

한 계정으로 로그인해도 **다른 계정의 비공개 데이터는 조회·변경할 수 없다**는 것을 코드와 실제 요청으로 확인한 기록입니다.

## 발견한 문제와 수정

| 구분 | 내용 |
|---|---|
| 문제 | 카드 1~4의 비공개 항목은 `lib/private/items.ts`에 박힌 **같은 4개 항목**을 모든 로그인 계정에 보여 주었다. 계정별 데이터가 없으니 "내 것만 보인다"를 증명할 수 없었다 |
| 수정 범위 | 소유자(`user_id`)가 있는 표 `private_items` 추가, 소유자 조건이 들어간 조회 함수, 항목 하나를 읽는 API 추가. 기존 표·함수·API 계약은 바꾸지 않았다(`GET /api/private-items`의 응답 모양 `{items: [...]}`은 같고, 각 항목에 `code`가 추가됨) |
| 마이그레이션 | `db/migrations/20261102100000_add_private_items.sql` (추가만. 기존 데이터를 지우거나 초기화하지 않음) |
| 가상 데이터 | 계정을 처음 조회할 때 `ensure_private_items(user_id)`가 그 계정 몫의 가상 항목 3개(메모·학습 목표·프로젝트 계획)를 채운다. 제목·본문에 **계정 태그**(사용자 id 해시 앞 6글자)가 들어가 계정마다 내용이 다르다. 이메일은 쓰지 않는다. 이미 있으면 아무것도 하지 않아 여러 번·동시에 불러도 3개다 |

## API

| 경로 | 동작 |
|---|---|
| `GET /api/private-items` | 로그인한 사용자의 항목 목록. 비로그인 401 |
| `GET /api/private-items/{item_id}` | 로그인한 사용자의 항목 하나. **남의 항목·없는 항목·형식이 틀린 id는 모두 같은 404**(존재 여부를 알 수 없음). 비로그인 401 |
| 그 밖의 메서드 | 쓰기 경로가 없어서 405 |

사용자는 **세션으로만** 정한다. `?user_id=`, 헤더, 요청 본문에 사용자 id를 넣어도 읽지 않는다.

## 접근 제어 코드 위치

| 확인 사항 | 파일 · 함수 |
|---|---|
| 세션에서 현재 사용자 식별 (API) | `lib/auth/require-user.ts` · `requireUser(request)` — 쿠키 또는 Bearer 토큰을 `supabase.auth.getUser()`로 **Supabase Auth 서버에 물어** 사용자 id를 얻는다 |
| 세션에서 현재 사용자 식별 (화면) | `lib/auth/require-user.ts` · `getCurrentUser()` — `app/private/page.tsx`가 호출 |
| 비공개 데이터 소유자 확인 | `lib/private/items.ts` · `listPrivateItems(user)`(`.eq("user_id", user.id)`), `getPrivateItem(user, itemId)`(`.eq("id", itemId).eq("user_id", user.id)`) |
| 다른 사용자 조회 차단 | 위 `getPrivateItem` + `app/api/private-items/[item_id]/route.ts` (없으면 404). 패스키는 `lib/passkeys/store.ts`의 `.eq("user_id", userId)`, DB 함수 `delete_passkey(p_user_id, …)` |
| 사용자 id를 클라이언트 입력으로 정하지 않음 | 두 API 모두 `auth.user.id`(세션에서 나온 값)만 `lib/private/items.ts`에 넘긴다. 쿼리·본문·헤더를 읽는 코드가 없다. 패스키 로그인도 사용자 id는 저장된 credential 행(`stored.data.user_id`)에서 얻는다(`app/api/passkeys/login/verify/route.ts`) |
| RLS | `private_items`는 `enable row level security`, `anon`·`authenticated` 권한 회수, `service_role`만 허용. **정책(policy)은 만들지 않았다** → 브라우저용 키로는 아무 행도 못 읽는다 |
| 서버 전용 키와 RLS 우회 | 서버는 `lib/supabase-server.ts`의 `getSupabaseAdmin()`(`SUPABASE_SECRET_KEY`, service role)로 DB에 접근한다. **service role은 RLS를 우회한다.** 그래서 이 프로젝트의 계정 격리는 RLS가 아니라 **앱 코드의 소유자 조건**이 지킨다. RLS는 "브라우저에서 DB를 직접 두드리는 경로"를 막는 두 번째 장치다 |

> RLS가 켜져 있다는 사실만으로 격리가 증명되지 않는다. 그래서 아래 시험은 실제 서버에 요청을 보내 확인했다.

## 시험 (양방향)

- `scripts/verify-isolation.mjs` : 시험 계정 두 개로 A→B, B→A를 모두 시험하고 전후 항목 수·내용 해시를 비교한다. (읽기와 "거절되어야 하는 쓰기"만 보낸다)
- `db/checks/private-isolation.sql` : DB에서 직접 계정별 항목 수·내용 해시, RLS·권한을 확인한다. 시험 **전/후 각각 실행해 비교**한다.
- 시험 항목: 자기 목록 / 상대 항목 id 직접 조회 / `?user_id=`·`?userId=`·`?owner=` 바꿔치기 / 사용자 id 헤더 변조 / POST·PUT·PATCH·DELETE + 본문 사용자 id / 없는 id·형식 오류·주입 문자열 id / 비로그인·로그아웃 후·만료 세션.
- **403만으로 통과 처리하지 않는다**: 시험 전후의 항목 수와 내용 해시가 같은지 DB에서 따로 비교한다.
