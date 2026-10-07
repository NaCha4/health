# 배포 준비

사용자가 2026-10-08에 이 프로젝트의 게시와 연결 작업을 승인했습니다. 아래는 재배포 절차입니다. 다른 프로젝트나 추가 변경에 대한 포괄 승인은 아닙니다.

현재 대상은 `NaCha4/health` 저장소와 `health-6b756` 프로젝트입니다. 기존 Firestore의 실제 ID는 **`default`** (괄호 없음), 위치는 `asia-northeast3`입니다. `firebase.json`도 이 DB만 지정합니다. 이메일 로그인과 소유자 UID를 사용하며 실제 값은 Git에서 제외합니다. 최초 비밀번호는 사용자가 사이트의 설정 메일 요청 버튼으로 직접 정합니다.

OAuth 콜백을 아직 등록하지 않았어도 웹 기록 기능은 사용할 수 있습니다. 빈 콜백 허용 목록은 모든 OAuth 연결 요청을 거부합니다. 정확한 ChatGPT 콜백을 확인한 다음 서버 환경값을 갱신해야 합니다.

## 확인할 정보

| 항목                    | 확인 위치                                                              |
| ----------------------- | ---------------------------------------------------------------------- |
| 프로젝트                | 사용자가 지정한 `health-6b756`                                         |
| Firestore DB ID·위치    | 기존 DB의 설정 확인. 새 DB를 생성·이전하지 않음                        |
| 함수 리전               | DB 위치를 고려해 `FUNCTION_REGION` 결정. 기본값 `asia-northeast3`      |
| 소유자 UID              | Firebase Authentication 본인 계정 UID                                  |
| 로그인 제공자           | Google 또는 이메일/비밀번호 중 실제 활성화한 방식                      |
| GitHub 저장소·Pages URL | 사용자 소유 저장소와 정확한 경로                                       |
| OAuth 콜백 URI          | ChatGPT 연결 설정의 정확한 HTTPS 주소. 추측·와일드카드 금지            |
| 식품 API 키             | 선택 사항. 식약처 I2790 활용 승인 또는 USDA 키가 있을 때만 서버에 입력 |

Firebase 웹 `apiKey`는 브라우저 초기화에 쓰는 클라이언트 설정이며 자체로 건강 데이터 접근을 허용하지 않습니다. 실제 입력값은 로그·문서에 표시하지 않고 `.env.local`은 Git에서 제외합니다. 서비스 계정 JSON이나 OAuth 토큰을 웹 설정에 넣으면 안 됩니다.

## 산출물 검증

```sh
npm ci
npm run typecheck
npm test
npm run test:rules
npm run build
```

Java 21, Node.js 22를 사용합니다. 브라우저 검증은 Browser 플러그인을 사용합니다. 실제 로그인을 시도하기 전에는 가상 체험을 사용하세요.

## Firebase 수동 배포 — 승인 후

1. `functions/.env.example`을 `functions/.env.health-6b756`에 복사하고 확인한 값만 입력합니다. `PUBLIC_BASE_URL`은 첫 배포 전 비워둘 수 있으며 서버는 구성 완료 전 503을 반환합니다. 제공자·도메인·사용자 설정 변경은 필요 시 별도 승인 대상입니다.
2. CLI의 로그인 계정과 프로젝트를 확인합니다. 기존 Firestore 규칙을 확인·보관하고 전용 DB인지 확인합니다. 현재 규칙은 **모든 클라이언트의 직접 읽기/쓰기를 거부**합니다. 다른 앱이 같은 DB를 사용한다면 그대로 덮어쓰지 마세요.
3. 승인된 소스에서 다음 명령을 수동 실행합니다.

```sh
npx firebase deploy --project health-6b756 --only firestore:rules,firestore:indexes,functions:health:api
```

4. 함수의 **직접 Cloud Run 서비스 URL**(`https://api-....run.app`)을 확인해 `PUBLIC_BASE_URL`에 입력합니다. `/api`가 붙는 `cloudfunctions.net` 주소는 사용하지 않습니다. OAuth 메타데이터가 원점의 `/.well-known/oauth-authorization-server`에서 발견되어야 하므로 경로 없는 원점이 필요합니다. `FRONTEND_URL`은 저장소 경로를 포함한 Pages 전체 URL입니다.
5. ChatGPT가 제공한 콜백을 `OAUTH_REDIRECT_URIS`에 정확히 입력합니다. 여러 주소는 쉼표로 구분합니다. `OAUTH_CLIENT_ID`는 공개 식별자이며 이 구현은 client secret이 없는 공개 PKCE 클라이언트 방식입니다.
6. 확인한 설정으로 함수를 다시 배포합니다. `/health`, OAuth 메타데이터, 미인증 `/mcp`의 401을 확인합니다. `invoker: public`은 OAuth 클라이언트의 HTTP 접근용이며 데이터 접근은 서버가 별도 검증합니다. 이 IAM 변경도 승인 없이 적용하지 않습니다.

식품 키는 서버 전용 환경 파일에 넣습니다. Functions 환경 변수로 전달되므로 운영자는 접근할 수 있습니다. 더 엄격한 보관이 필요하면 Secret Manager 바인딩을 별도 승인·검토 후 적용하세요. 현재 코드는 키나 Secret Manager 리소스를 만들지 않습니다. 키가 없으면 검색은 미구성 오류를 반환하고 직접 입력은 계속 가능합니다.

## GitHub Pages 수동 게시 — 승인 후

`.github/workflows/pages.yml`은 `workflow_dispatch`만 수신합니다. push나 PR로 자동 게시하지 않습니다. `check.yml`은 PR/수동 검증만 합니다.

1. 승인된 변경을 저장소에 올리고 Pages Source를 GitHub Actions로 설정합니다. push와 설정 변경도 별도 승인 대상입니다.
2. Repository **Secret**에 `VITE_FIREBASE_API_KEY`를 입력합니다. 웹에 포함되는 클라이언트 설정이지만 문서·로그 노출을 줄이기 위해 평문 커밋하지 않습니다.
3. Repository **Variables**에 아래 값을 입력합니다.

```text
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_API_BASE_URL
VITE_GOOGLE_SIGN_IN_ENABLED
PAGES_BASE_PATH
```

`VITE_API_BASE_URL`은 직접 Cloud Run 원점입니다. `PAGES_BASE_PATH`는 프로젝트 저장소면 `/저장소이름/`, 루트 사이트면 `/`입니다. 미지정 기본값은 `./`이며 해시 라우팅으로 세부 화면 새로고침을 지원합니다.

4. Authentication 승인 도메인에 Pages 호스트를 등록하고 로그인 제공자를 확인합니다. 서버 CORS는 `FRONTEND_URL` 원점만 허용합니다.
5. 승인된 브랜치에서 **Publish GitHub Pages (manual)**을 실행합니다. `dist`만 게시하며 환경 파일·함수 소스·백업을 게시하지 않습니다.

## 실제 dot 연결 확인

- Pages에서 본인 계정으로 로그인하고 비소유자는 403인지 확인합니다.
- 승인 후 가상이라고 명시한 실제 테스트 기록 한 건을 저장·수정합니다.
- ChatGPT 사용자 정의 MCP에 `PUBLIC_BASE_URL/mcp`, 공개 client ID, OAuth를 설정합니다. 현재 계정이 공개 PKCE 클라이언트를 지원하는지 확인합니다.
- 동의 화면의 소유자 계정과 `health:read` / `health:write` 권한을 확인하고 사용자가 직접 허용합니다.
- dot 생성 기록이 웹에 나타나고, 웹 수정값이 dot 조회에 나타나는지 확인합니다.
- 연결 해제 이후 이전 토큰의 접근이 막히는지 확인합니다. 토큰을 채팅·화면·로그에 노출하지 않습니다.
- 실제 DB의 테스트 기록 정리도 별도 승인된 범위에서 수행합니다.

클라이언트가 공개 PKCE를 지원하지 않으면 이 인증 구현을 그대로 연결할 수 없습니다. 그 경우 인증 제공자나 해당 인증 방식을 추가해야 하며 웹 ID 토큰 복사로 우회하지 않습니다.

## 영향과 승인 범위

위험 관련 파일은 `functions/src/index.ts`, `app.ts`, `oauth.ts`, `health.ts`, `firestore.rules`, Firebase 설정, 웹 로그인 코드, Pages 워크플로입니다. 서버 Admin SDK는 규칙을 우회하므로 소유자 UID allowlist가 필수입니다.

코드 검증은 [구현 기록](implementation.md)을 확인하세요. 최초 게시 작업에서 API HTTP 호출 권한, 이메일 로그인 제공자, Pages 승인 도메인을 설정합니다. 운영 데이터의 일괄 삭제·이전은 수행하지 않습니다. 실제 사용량에 따른 예산 알림과 DB 백업 보존 기간은 별도 운영 정책으로 정해야 합니다.
