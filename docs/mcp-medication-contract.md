# MCP 약물 일정·실제 투여 입력 계약

서버 버전 `1.1.1`. 기존 OAuth `health:read health:write`, 소유자, URL과 11개 도구를 유지합니다. 일반 기록의 기존 호출은 그대로 동작합니다. 약물 일정은 사용자에게 확인한 내용을 기록하는 기능이며 약물 선택이나 용량 결정을 자동 수행하지 않습니다.

정확한 종류는 `medication`(처방 일정), `dose`(실제 복용·미복용)입니다. `medication_plan`, `administration`은 종류 이름으로 사용하지 않습니다. 추가 종류는 `symptom`, `sleep`입니다. 생성·수정 도구의 `entry`와 목록 도구의 `kind`에 총 14종이 광고됩니다. `medication`의 직접 수정은 이력 보존을 위해 거절하므로 변경·중단은 아래 새 기록 생성 절차를 사용합니다.

```ts
type MedicationInput = {
  kind: 'medication';
  date: string; // YYYY-MM-DD 적용일, 실제 달력 날짜
  name: string; // 1~200자
  dose: string; // 1~200자, 사용자 확인 용량과 단위
  doseConfirmed: true;
  route: 'oral' | 'injection' | 'other';
  schedule: string; // 1~1000자, 사용자 확인 일정
  status: 'active' | 'paused' | 'stopped';
  previousId?: string; // 변경·중단 시 이전 medication ID
  changeReason?: string; // 최대 4000자
  note?: string; // 최대 4000자
  occurredAt?: string; // offset 포함 ISO 8601, 한국 날짜가 date와 같아야 함
};
type DoseInput = {
  kind: 'dose';
  date: string; // YYYY-MM-DD, 한국 날짜
  medicationId: string; // 같은 계정의 당시 medication ID
  occurredAt: string; // offset 포함 ISO 8601, 미래 불가, 한국 날짜와 date 일치
  status: 'taken' | 'skipped';
  actualDose: string | null; // taken: 실제량 1~200자, skipped: null
  note?: string; // 최대 4000자
};
type CreateMedicationRequest = {
  requestId: string; // 8~150자, [A-Za-z0-9:_-]+, 같은 요청 재시도에는 같은 ID/내용
  entry: MedicationInput;
  medicationConfirmedByUser: true;
};
type CreateDoseRequest = { requestId: string; entry: DoseInput };
type UpdateDoseRequest = {
  requestId: string;
  id: string;
  expectedVersion: number; // 현재 양의 정수 버전
  entry: DoseInput; // 유지할 필드도 포함한 전체 입력
};
```

ID는 `[A-Za-z0-9_-]{1,128}`입니다. 모든 entry 객체는 정의되지 않은 필드를 거절합니다. 문자열은 앞뒤 공백을 제거합니다. 사용자 확인 플래그는 `entry` 안이 아니라 `create_health_entry`의 최상위 인자입니다. 약물 일정 이외의 기존 생성 요청에서는 생략합니다. 플래그가 없거나 false이면 dot 약물 일정 생성은 `user_decision`으로 거절하며 아무 기록도 쓰지 않습니다.

최초 일정은 `create_health_entry`에 `CreateMedicationRequest`를 보냅니다. 반환된 `entry.id`가 실제 투여의 `medicationId`입니다. 변경·중단은 새 적용일의 전체 일정·상태를 확인한 뒤 `entry.previousId`를 이전 기록 ID로 지정하여 다시 생성합니다. 이전 처방과 기존 투여 연결은 남습니다. 같은 이전 처방에 대한 동시 변경은 하나만 허용합니다.

실제 투여는 `create_health_entry`에 `CreateDoseRequest`, 수정은 `update_health_entry`에 `UpdateDoseRequest`를 보냅니다. 목록은 `list_health_entries({kind:'medication'})` 또는 `{kind:'dose'}`로 조회합니다. 조회·쓰기 권한, 버전 충돌, 중복 요청과 다른 계정 참조 차단은 기존과 동일합니다.

## 연결의 메타데이터 갱신

서버 배포만으로 이미 열린 대화의 캐시된 도구 스키마가 바뀌었다고 간주하지 않습니다. [OpenAI 공식 절차](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata)에 따라 기존 하루결 연결을 열고 **Refresh / Refresh tools**로 도구 메타데이터를 갱신한 뒤 새 대화를 시작합니다. 기존 연결을 삭제하거나 Connect another account로 새 계정을 추가하지 않습니다. 새 OAuth 범위·클라이언트·토큰을 만들지 않습니다.

갱신 후 `create_health_entry`에 최상위 `medicationConfirmedByUser`와 `entry.kind='medication'|'dose'|'symptom'|'sleep'`이, `list_health_entries.kind`에도 네 종류가 있는지 확인합니다. `dose`와 `medication`은 별도 유형입니다. context 메모로 대체하지 않습니다. 갱신 화면에서 재인증·추가 권한을 요구하면 진행하지 않고 해당 요구를 보고합니다.

합성 MemoryStore/OAuth HTTP 테스트는 실제 `tools/list` JSON의 종류, 확인 필드, 기존 계약과 처방 생성→실제 투여→조회·요약을 확인합니다. 운영 건강 데이터에 테스트 기록을 넣지 않습니다.
