# 숭민이

유어슈(Yourssu) 사내 AI 어시스턴트 Slack 봇. 개발/비개발 구분 없이 자연어로 사내 데이터에 접근할 수 있는 LLM 에이전트.

## 사용 방법

Slack에서 두 가지 방식으로 질문:

- **@멘션**: 채널에서 `@숭민이 PostHog에 어떤 이벤트가 있어?`
- **DM**: 봇과 1:1 대화

LLM이 자동으로 적절한 도구를 선택해 답변합니다.

## 아키텍처

```
사용자 메시지
    ↓
handlers/mention.py — @멘션/DM 감지
    ↓
agent/orchestrator.py — LLM API tool use 루프
    ↓  (LLM이 도구 선택)
tools/* — PostHog, Notion, GitHub, Linear 등
```

- **단일 에이전트 + Tool Registry**: LLM이 `tool_use`로 필요한 도구를 자동 선택
- **스레드 단위 대화**: Slack 스레드 = 하나의 대화 컨텍스트
- **Socket Mode**: 공개 URL 불필요, 봇이 Slack에 WebSocket 연결

## 프로젝트 구조

```
app.py                      # 엔트리포인트
config.py                   # 환경변수 (Pydantic Settings)
agent/
  orchestrator.py           # LLM API + tool dispatch 루프
  prompt_builder.py         # 시스템 프롬프트 생성
  conversation_store.py     # 스레드별 대화 기록 (in-memory)
tools/
  base.py                   # BaseTool 추상 클래스
  registry.py               # ToolRegistry
  posthog/                  # PostHog 데이터 분석 (이벤트, 인사이트, 코호트 등)
handlers/
  mention.py                # @멘션/DM 이벤트 핸들러
```

## 새 도구 추가 방법

1. `tools/<서비스>/tool.py`에서 `BaseTool` 상속 및 `client.py`에 API 래퍼 작성:

```python
from tools.base import BaseTool

class MyTool(BaseTool):
    @property
    def name(self) -> str:
        return "my_tool_name"

    @property
    def description(self) -> str:
        return "이 도구가 언제 필요한지 설명 (LLM이 판단 근거로 사용)"

    def get_schema(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": [...]},
                    },
                    "required": ["action"],
                },
            },
        }

    def execute(self, params: dict) -> str:
        return "결과 텍스트"
```

2. `config.py`에 필요한 환경변수 추가 (선택적, 기본값 `""`)
3. `app.py`의 `create_app()`에서 조건부 등록: `if settings.xxx_key: registry.register(...)`

## 로컬 개발

```bash
# 의존성 설치
pip install -r requirements.txt

# .env 파일 설정
cp .env.example .env
# .env에 API 키 입력

# 실행
python app.py
```

## 배포

`main` 브랜치에 push하면 GitHub Actions가 자동으로 EC2에 배포합니다.

필요한 GitHub Secrets: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `LLM_API_KEY`, `LLM_BASE_URL`, `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`

## 기술 스택

- **Python 3.12** + slack-bolt (Socket Mode)
- **LLM** (OpenAI 호환 API, tool use via httpx)
- **Docker** + GitHub Actions CI/CD → EC2
