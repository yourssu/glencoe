export const ssutimePostHogProjectId = "440922";

export const ssutimePostHogKnowledge = `
## SSUTime (슈타임) 도메인 지식

### 서비스 개요
SSU-Time(슈타임) — 숭실대학교 시간표/공강 관리 모바일 앱. 주요 기능: 시간표 관리, 과제 추적, 공강 알림(전화 알림), 홈 화면 위젯. Android/iOS 지원.

### 사용자 식별자 (User Schema)
- **person_id**: PostHog 내부 사용자 ID (시스템 생성, 불변)
- **distinct_id**: 익명/식별 사용자 ID. 로그인 전에는 익명 ID, 로그인 후 회원 ID에 매핑됨
- **$identify 이벤트**: 익명 → 식별 사용자 병합 지점. 회원가입/로그인 시점에 발생

### 사용자 속성 (주요, 이벤트 기준)
- **디바이스**: \`$device_model\`, \`$device_name\`, \`$device_manufacturer\`, \`$device_type\`
- **OS**: \`$os\`, \`$os_version\`, \`$os_name\`
- **앱**: \`$app_version\`, \`$app_build\`, \`$app_name\`, \`$app_namespace\`
- **환경**: \`$locale\`, \`$geoip_country_name\`, \`$geoip_city_name\`, \`$network_wifi\`, \`$network_cellular\`

> 참고: person-on-events 모드. \`person.properties.*\` 조회 시 이벤트 수집 시점의 값으로 나옴(현재값 아님). 같은 사용자가 이벤트마다 다른 값을 가질 수 있음.

### 주요 이벤트 (Event Spec)

**인증**
- \`view_login\`: 로그인 화면 진입
- \`login_attempt\`: 로그인 시도
- \`login_success\`: 로그인 성공
- \`login_fail\`: 로그인 실패
- \`kakao_click\`: 카카오 로그인 버튼 클릭 (주요 진입 경로)
- \`logout_click\` / \`logout_confirm\` / \`logout_cancel\`: 로그아웃 플로우

**화면 조회**
- \`view_home\`: 홈 화면 진입
- \`view_mypage\`: 마이페이지 진입
- \`$screen\`: PostHog 자동 화면 전환 추적

**과제 (Task)**
- \`task_detail_expand\` / \`task_detail_collapse\`: 과제 상세 펼치기/접기
- \`todo_snapshot\`: 할 일 스냅샷 (크롤링 이벤트 — 사용자 액션이 아닌 자동 발생 이벤트)
- \`submit_complete_click\`: 제출 완료 클릭

**홈 화면 위젯**
- \`widget_display\`: 위젯 표시
- \`widget_tap\` / \`widget_refresh_tap\`: 위젯 탭/새로고침
- \`widget_banner_click\` / \`widget_banner_confirm\` / \`widget_banner_dismiss\`: 위젯 배너 상호작용

**알림**
- \`notification_received\` / \`notification_tap\`: 일반 푸시 알림
- \`call_alert_received\` / \`call_alert_accept\` / \`call_alert_reject\`: 전화 알림 (공강 알림)
- \`alarm_permission\`: 알람 권한 요청
- \`setting_system_alarm\` / \`setting_call_alarm\`: 알람 설정 화면 진입

**앱스토어 / 설치**
- \`app_store_redirect\`: 앱스토어로 이동
- \`app_store_installed\`: 앱스토어 설치 완료
- \`Application Installed\` / \`Application Opened\`: PostHog 자동 수집

**새로고침**
- \`refresh_click\`, \`pull_to_refresh\`

### 신규 유저 정의 (권장)
- **정의**: person_id별 첫 이벤트 발생일(\`min(timestamp)\`)이 타겟 기간에 속하는 사용자
- **권장 쿼리**:
\`\`\`sql
SELECT toDate(first_seen) AS date, count() AS new_users
FROM (
  SELECT person_id, min(timestamp) AS first_seen
  FROM events
  WHERE timestamp >= '<시작일>' AND timestamp < '<종료일>'
  GROUP BY person_id
)
GROUP BY date
ORDER BY date
\`\`\`
- **절대 금지**: \`persons\` 테이블에 추가 \`GROUP BY\` (\`argMax\` 집계 뷰라 500 에러). \`events\` 기반 집계 필수.

### 비즈니스 컨텍스트
- **시즌성**: 학기 시작(개학), 중간/기말고사, 수강신청 기간에 트래픽 폭발. 방학 중에는 급감.
- **공강 알림(\`call_alert_*\`)**: 학기 중에만 활발. 핵심 차별화 기능.
- **위젯 설치 베이스**: 헤비 유저의 proxy 지표 (\`widget_display\` 빈도로 파악)
- **카카오 로그인(\`kakao_click\`)**: 신규 유저의 주요 진입 경로
- **타임존**: KST(Asia/Seoul). 쿼리 시 \`timestamp + INTERVAL 9 HOUR\` 또는 \`toTimeZone(timestamp, 'Asia/Seoul')\` 권장.

### HogQL 쿼리 팁
- 일자별 집계는 \`events\` 테이블 기준. \`persons\`는 \`GROUP BY\` 없는 단순 조회만 안전.
- 사용자 수 카운트: \`uniqExact(person_id)\` (정확) 또는 \`countDistinct(person_id)\`.
- 시간대 변환: \`toTimeZone(timestamp, 'Asia/Seoul')\` 후 \`toDate()\`.
- **DAU/유저 리텐션 계산 시 주의**: \`todo_snapshot\` 이벤트는 크롤링으로 자동 발생하는 이벤트이므로, DAU(Daily Active Users)나 유저 리텐션(User Retention) 지표에서 반드시 제외해야 함. 예: \`WHERE event != 'todo_snapshot'\`.
`.trim();
