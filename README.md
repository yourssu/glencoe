# Glen

유어슈(Yourssu) 사내 AI 어시스턴트 Slack 봇. 개발/비개발 구분 없이 자연어로 사내 데이터에 접근할 수 있는 LLM 에이전트.

## 사용 방법

Slack에서 세 가지 방식으로 Glen에게 질문:

- 채널에서 `glen` 키워드: "glen 이 기획 어떻게 나온건지 맥락 찾아줘"
- @멘션: `@Glen 검색 규칙 어떻게 적용되어있어?`
- DM: 봇과 1:1 대화

Glen이 자동으로 적절한 도구(Notion, GitHub, Slack 검색 등)를 선택해 답변합니다.

## 아키텍처

```
사용자 메시지
    ↓
handlers/mention.py — "glen" 키워드/멘션 감지
    ↓
agent/orchestrator.py — Claude API tool use 루프
    ↓  (Claude가 도구 선택)
tools/* — Notion, Slack, GitHub, PostHog, Linear
```

- **단일 에이전트 + Tool Registry**: Claude가 `tool_use`로 필요한 도구를 자동 선택
- **스레드 단위 대화**: Slack 스레드 = 하나의 대화 컨텍스트
- **Socket Mode**: 공개 URL 불필요, 봇이 Slack에 WebSocket 연결

## 프로젝트 구조

```
app.py                      # 엔트리포인트
config.py                   # 환경변수 (Pydantic Settings)
agent/
  orchestrator.py           # Claude API + tool dispatch 루프
  prompt_builder.py         # 시스템 프롬프트 생성
  conversation_store.py     # 스레드별 대화 기록 (in-memory)
  models.py                 # 데이터 모델
tools/
  base.py                   # BaseTool 추상 클래스
  registry.py               # ToolRegistry
  notion/                   # Notion 검색 도구
  slack_search/             # (예정) Slack 메시지 검색
  github/                   # (예정) GitHub 코드/PR 검색
  posthog/                  # (예정) PostHog 데이터 분석
  linear/                   # (예정) Linear 이슈 조회
handlers/
  mention.py                # 키워드/멘션 이벤트 핸들러
middleware/                 # (예정) rate limiting, 에러 핸들링
```

## 새 도구 추가 방법

1. `tools/<서비스>/tool.py`에서 `BaseTool` 상속:

```python
from tools.base import BaseTool

class MyTool(BaseTool):
    @property
    def name(self) -> str:
        return "my_tool_name"

    @property
    def description(self) -> str:
        return "이 도구가 언제 필요한지 설명 (Claude가 판단 근거로 사용)"

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "..."},
                },
                "required": ["query"],
            },
        }

    def execute(self, params: dict) -> str:
        # 실제 API 호출 후 문자열 결과 반환
        return "결과 텍스트"
```

2. `config.py`에 필요한 환경변수 추가
3. `app.py`의 `create_app()`에서 `registry.register(MyTool(...))` 추가

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

필요한 GitHub Secrets: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `ANTHROPIC_API_KEY`, `NOTION_API_KEY`

## 기술 스택

- **Python 3.12** + slack-bolt (Socket Mode)
- **Claude API** (Anthropic, tool use)
- **Docker** + GitHub Actions CI/CD → EC2
