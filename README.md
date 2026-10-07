# 하루결 · dot health

신체정보, 체중, 식사, 운동과 분석을 함께 보관하는 개인 건강 기록 서비스입니다. GitHub Pages에 React 화면을 올리고 Firebase Authentication·Firestore·Cloud Functions를 사용합니다. ChatGPT의 dot는 OAuth로 보호된 MCP 도구 11개를 통해 같은 기록을 읽고 씁니다.

## 로컬 실행

Node.js 22와 npm을 사용합니다.

```sh
npm ci
npm run dev
```

`http://127.0.0.1:5173`에서 **먼저 가상 기록으로 둘러보기**를 누르세요. 체험 데이터는 브라우저 메모리에만 있고 새로고침하면 초기화됩니다. 개인 데이터와 섞이지 않습니다. 가상 체험에는 로그인이 필요하지 않습니다.

사용자가 입력한 `.env.local`은 유지했으며 Git에서 제외합니다. 서버 배포 후 `VITE_API_BASE_URL`을 추가해야 실제 저장 기능이 연결됩니다. 빈 양식은 [`.env.example`](.env.example), 서버 양식은 [`functions/.env.example`](functions/.env.example)입니다. 실제 키·토큰·백업을 커밋하지 마세요.

## 구현된 기능

- 오늘: 최신 측정일이 있는 체중, 7일 평균과 이전 기간 비교, 섭취·예상 소비, 빠른 기록, 하루 완료 점검.
- 기록: 달력, 날짜·종류·검색, 상세·수정 이력, 휴지통·복원·별도 확인을 거치는 영구 삭제.
- 변화: 7·30·90일 및 지정 기간, 체중·에너지 그래프, 7일 단위 운동, 이전 기간 비교, 수치 표와 계산 근거.
- 분석: dot 보고서, 근거 링크, 원본 변경 시 재검토 표시, 실천 제안의 채택·보류·완료, 분석 요청 문구 복사.
- 설정: 시점별 신체정보·생활 활동, 목표·선호, OAuth 연결 해제, JSON 원본·이력 백업, CSV, 빈 계정으로 JSON 복원.
- 음식: 식약처 I2790·USDA 검색 어댑터, 단위·기준량·영양소·추정 범위·출처 스냅샷. 키가 없어도 직접 입력 가능.
- 서버: Firebase ID 토큰/소유자 UID 검증, OAuth code+S256 PKCE, 토큰 갱신·재사용 차단, 버전 충돌과 중복 저장 방지.

dot의 사진 해석과 일반 웹 검색은 ChatGPT가 제공하는 도구로 수행하고 결과를 구조화해서 저장합니다. 홈페이지의 별도 모델 API와 사진 보관함은 기획의 후속 범위입니다.

## 검증

```sh
npm run typecheck
npm test
npm run test:rules
npm run build
```

`test:rules`에는 Java 21이 필요합니다. 이 명령은 `firebase.emulators.json`과 **demo-dot-health**만 사용합니다. Firestore/Auth 에뮬레이터의 loopback 주소가 아니면 중단됩니다. 첫 실행에는 에뮬레이터 다운로드가 필요합니다. 운영 프로젝트 데이터는 읽거나 수정하지 않습니다.

개별 MCP HTTP 개발에는 `npm run dev:server`를 사용할 수 있습니다. `127.0.0.1:8787`에서만 듣는 가상 메모리 서버이며 배포에 포함되지 않습니다. 일반 UI 체험에는 필요하지 않습니다.

## 구조

| 경로                      | 역할                                          |
| ------------------------- | --------------------------------------------- |
| `src/`                    | React 화면, 웹 로그인, API 연결과 메모리 체험 |
| `shared/schema.ts`        | 공유 입력 검증과 타입                         |
| `shared/energy.ts`        | 원본에서 재계산하는 에너지·통계 함수          |
| `functions/src/health.ts` | 공통 저장, 이력, 버전, 삭제·복원·백업         |
| `functions/src/oauth.ts`  | OAuth 동의, 토큰 해시 저장, 갱신·폐기         |
| `functions/src/mcp.ts`    | Streamable HTTP MCP 도구                      |
| `functions/src/app.ts`    | HTTP API와 권한 경계                          |
| `functions/src/index.ts`  | Firebase 함수 진입점과 서버 설정              |
| `tests/`                  | 계산·저장·OAuth·MCP·식품 응답·에뮬레이터 검증 |

웹은 인증된 원본 스냅샷을 가져와 공유 계산 함수를 실행하고, MCP는 서버에서 같은 함수를 실행합니다. 변경 없는 웹 갱신은 메타데이터 버전만 읽어 전체 재조회를 줄입니다.

## 배포 준비

소스 구현과 로컬 검증을 완료했으며 **외부 배포는 실행하지 않았습니다.** 실제 dot의 계정 연결은 공개 HTTPS 서버가 생긴 뒤 별도로 확인해야 합니다. 테스트 MCP 클라이언트의 왕복 검증을 실제 ChatGPT 연결 검증으로 간주하지 않습니다.

GitHub 저장소·Pages 주소, 로그인 제공자, 소유자 UID, Firestore 위치/DB ID, ChatGPT 콜백 URL 확인이 남아 있습니다. 선택적 식품 API 자격증명도 생성하지 않았습니다.

[`배포 절차`](docs/deployment.md)에 설정·권한 변경 범위와 수동 확인 절차가 있습니다. Pages 워크플로는 수동 실행만 지원하며 Firebase 자동 배포는 없습니다. 사용자 승인 없이 push·배포·운영 데이터 수정·자격증명 발급을 수행하지 않습니다.

[`기획`](docs/product-plan.md) · [`계산 명세`](docs/energy-calculation.md) · [`구현 계약·검증·한계`](docs/implementation.md)

최종 검증: 42개 테스트 통과, 타입 검사/빌드 성공, Browser를 통한 데스크톱·320px·390px 검증 완료. dot 설정에 사용할 [지침 예시](docs/dot-instructions.md)도 포함합니다.
