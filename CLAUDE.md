# CLAUDE.md

이 프로젝트는 Python 기반 Slack AI 에이전트 봇(Glen)입니다.

## 기본 규칙

- 언어: Python 3.9+ 호환 (Docker 배포는 3.12). `X | None` 대신 `from __future__ import annotations` 사용
- 프레임워크: slack-bolt (Socket Mode)
- LLM: Anthropic Claude API (tool use)
- 설정: Pydantic Settings (`config.py`), `.env` 파일로 관리
- **절대 `.env` 파일을 커밋하지 않기**

## 아키텍처

- **단일 에이전트 패턴**: Claude가 tool_use로 도구를 자동 선택
- **BaseTool 인터페이스** (`tools/base.py`): 모든 도구가 상속하는 추상 클래스
- **ToolRegistry** (`tools/registry.py`): 도구 등록/실행 관리
- **Orchestrator** (`agent/orchestrator.py`): Claude API 호출 → tool_use → 도구 실행 → 응답 루프
- **대화 단위**: Slack 스레드 (channel_id:thread_ts)

## 새 도구 추가 시

1. `tools/<서비스>/` 디렉토리에 `tool.py`(BaseTool 상속)와 `client.py`(API 래퍼) 생성
2. `config.py`에 환경변수 추가 (선택적, 기본값 `""`)
3. `app.py`의 `create_app()`에서 조건부 등록: `if settings.xxx_key: registry.register(...)`
4. 도구의 `description`은 Claude가 선택 근거로 사용하므로 한국어/영어 모두 고려

## 컨벤션

- 타입 힌트: `from __future__ import annotations`로 Python 3.9 호환
- 에러 처리: 도구 실행 실패 시 사용자에게 한국어 친화적 메시지, 원본 에러 노출 금지
- 슬래시 명령어가 아닌 키워드("glen") + @멘션 + DM으로 트리거
- 항상 스레드에 답글 (`say(text=..., thread_ts=...)`)
- `.gitignore`에 `learn.md`, `plan.md` 포함됨 (학습 문서)
