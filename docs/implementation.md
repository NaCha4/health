# 구현 계약과 검증

## 원본과 계산

`users/{uid}/entries/{id}`에 `kind`로 구분한 원본을 한 건씩 저장합니다. 개념별 컬렉션을 제안한 기획을 공통 컬렉션으로 통합해 버전·수정·검색 로직을 공유했습니다. 한 문서에 전체 기록을 쌓지 않습니다. 음식에는 영양 기준과 출처를 복사해 보관합니다.

`changes/{id}`는 변경 전·후 원본, 작성 경로, 시각과 데이터 버전을 보관합니다. `requests/{hash}`는 재시도 응답과 fingerprint를 보관합니다. UID는 인증에서 결정합니다. 사용자 문서는 전체 버전을 보관합니다.

API는 `/v1/snapshot`, `/entries`, `/history`, `/summary`, `/energy`, `/nutrition`, `/export`, `/import`, `/connections`, `/oauth/request`, `/oauth/approve`입니다. 생성은 `requestId`와 `entry`, 수정은 `id`, `expectedVersion`과 전체 `entry`를 사용합니다. 내부 오류나 인증정보를 그대로 응답하지 않습니다.

신체정보·생활 활동은 적용일이 있는 **전체 스냅샷**입니다. 갱신 시 유지할 항목도 포함해야 합니다. 입력되지 않은 신체 특성은 추측하지 않습니다. 음식 영양값은 `basisAmount`당 값이고 실제 섭취는 `quantity / basisAmount`를 곱합니다. `null`은 미상이며 0과 다릅니다.

`shared/energy.ts`를 웹과 서버가 함께 사용합니다. 웹은 인증된 스냅샷, MCP는 서버 원본으로 같은 함수를 실행합니다. 계산 합계를 원본처럼 영구 보관하지 않습니다. 변경 없는 웹 갱신은 메타데이터 버전만 조회합니다.

- Mifflin–St Jeor 성인식의 나이·계수·키·체중과 적용 여부 확인.
- 미래 신체정보/체중을 과거로 소급하지 않음. 일별 대표 체중 사용.
- 운동 총소비, 휴식 1 MET 대비 순소비, 대체 활동 대비 추가 소비 분리.
- 운동 포함 활동 계수에는 운동을 다시 더하지 않음. 계획·중복 운동 제외.
- 미상 영양정보 수와 기록 완성도 표시. 오늘/미완료 날짜에는 에너지 차이를 표시하지 않음.
- 추정 범위는 음식 분량·열량 시나리오이며 개인 소비량의 신뢰구간이 아님.

식약처 I2790 명세에서 `SERVING_SIZE`는 총내용량, 영양값은 1회 제공량당이므로 중량으로 임의 환산하지 않고 **1회 제공량**으로 반환합니다. 실제 섭취한 제공량을 확인해야 합니다. USDA는 100g 기준과 1008/2048/2047 에너지 항목의 kcal 단위를 확인합니다.

근거: [Mifflin 원문](https://pubmed.ncbi.nlm.nih.gov/2305711/), [활동 MET](https://pacompendium.com/), [식약처 명세](https://www.foodsafetykorea.go.kr/api/openApiInfo.do?menu_grp=MENU_GRP31&menu_no=661&show_cnt=10&start_idx=1&svc_no=I2790&svc_type_cd=API_TYPE06), [USDA](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/).

## OAuth와 MCP

Streamable HTTP 서버는 요청별로 생성되어 특정 함수 인스턴스의 세션을 유지하지 않습니다. 사전 등록 client ID, 정확한 callback, `state`, S256 PKCE, resource indicator, 명시적 동의를 사용합니다. 동의는 Firebase ID 토큰과 소유자를 확인합니다.

access token은 15분, refresh token은 최대 30일, grant는 최대 90일입니다. 인증 코드·요청·토큰은 해시 키로 저장하고 access/refresh 원문을 저장하지 않습니다. refresh 재사용은 grant 전체를 취소합니다. 매 MCP 요청은 grant 해제와 소유자를 다시 확인합니다. OAuth 인스턴스별 호출 제한은 전역 비용 상한을 보장하지 않습니다.

`get_health_context`, `list_health_entries`, `get_health_summary`, `record_body_profile`, `search_food_nutrition`, `save_meal_estimate`, `calculate_energy_balance`, `create_health_entry`, `update_health_entry`, `save_analysis_report`, `propose_action`을 제공합니다. 목록은 최대 100개씩입니다. 사용자 기록은 데이터이며 지시로 해석하지 않아야 합니다. dot는 목표·확인된 선호 변경이나 삭제를 하지 못하고 제안 채택은 웹에서 처리합니다.

설계 기준: [OpenAI MCP 인증](https://developers.openai.com/plugins/build/auth), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## 복구와 삭제

JSON은 원본·전체 이력을 일관된 트랜잭션으로 내보냅니다. 복원은 비어 있는 계정에만 가능하고 ID·관계를 유지합니다. 파일 전체 검증 후 200개 단위로 저장하며 진행 중에는 일반 읽기/쓰기를 잠급니다. 중단되면 같은 파일로 재개합니다.

영구 삭제는 휴지통 최신 버전과 확인 문구가 필요합니다. 원본·이력, ID로 연결된 분석·실천 항목을 제거하고 중복 방지 응답도 지웁니다. 다른 메모에 사람이 복사한 문장, 내려받은 파일과 별도 Firestore 백업은 자동 삭제하지 않습니다.

## 검증

- 계산·날짜·스키마 18개, 저장·복구 9개, OAuth·HTTP·MCP 9개, 음식 응답 3개.
- 실제 Firestore/Auth 에뮬레이터 3개: 직접 접근 거부, 트랜잭션·복구, Firebase 토큰 API 인증.
- MCP HTTP: 도구 조회 → MCP 생성 → 웹 조회·수정 → MCP 재조회.
- Browser 플러그인으로 가상 데스크톱·모바일 입력과 탐색 검증.
- TypeScript, Vite와 Functions 빌드.

2026-10-08 Firebase API와 GitHub Pages 배포를 완료했습니다. 공개 상태·OAuth 정보·미인증 요청 차단과 배포된 가상 체험을 확인했습니다. 실제 음식 API 키 호출, 소유자의 첫 로그인, 실제 ChatGPT dot 연결은 실행하지 않았습니다. 플랫폼 OAuth 동의 왕복은 사용자 로그인 후 최종 확인이 필요합니다.

## 제한

개인용 초기 버전은 원본·이력 각각 10,000개를 전체 스냅샷/내보내기 상한으로 둡니다. 초과하면 조용히 누락하지 않고 오류를 반환합니다. 변경 후 웹 스냅샷과 MCP 계산은 이 범위의 전체 원본을 읽습니다. 인덱스 기반 범위 쿼리와 장기 아카이브는 확장 대상입니다.

영구 삭제는 관련 문서 합계 450개 이내, 가져오기는 8 MB 이내입니다. 큰 삭제는 원자성을 지키기 위해 중단합니다. OAuth 만료 문서 TTL, DB 백업/보존은 운영 설정이므로 자동 적용하지 않았습니다.

식품 검색은 서버키·제공처 승인·가용성에 의존합니다. 없어도 직접 입력과 dot의 외부 검색 근거를 사용할 수 있습니다. 실제 호출 대신 fixture로 응답 변환을 검증했습니다.

가상 체험은 새로고침 시 초기화되는 화면 검증용입니다. 완전한 트랜잭션과 영구 보존은 Firebase 경로가 제공합니다. 가상 수치는 개인 신체정보나 권장치가 아닙니다.

## 최종 실행 결과

2026-10-08: 핵심 테스트 39개와 실제 로컬 에뮬레이터 테스트 3개, 총 42개 통과. 타입 검사와 웹/함수 빌드 성공. Browser 플러그인으로 데스크톱 생성·수정·삭제·복원·미상 식사·제안 채택, 320px/390px 전체 화면의 가로 넘침 및 모바일 저장을 확인했다. 로컬 Node.js는 24.8.0이고 배포 대상 및 CI는 Node.js 22로 지정했다.

보고서는 각 원본의 변경 데이터 버전으로 재검토 여부를 판단하며, 오래된 백업에 버전 메타데이터가 없으면 시각 비교로 보완한다. OAuth 만료 필드는 비교용 숫자이므로 네이티브 Firestore TTL을 적용하려면 Timestamp 필드와 보존 정책을 별도로 설계·승인해야 한다.

GitHub Linux / Node.js 22에서도 42개 테스트·타입 검사·빌드가 통과했다. 배포 전에는 Firebase CLI와 동일한 파일 선택 규칙으로 실행 모듈 10개와 비공개 설정 제외 여부를 검사한다. 함수 리전 환경 변수는 예약 이름을 피해 `HEALTH_FUNCTION_REGION`을 사용한다.
