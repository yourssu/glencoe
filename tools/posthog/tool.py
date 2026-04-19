from __future__ import annotations

from tools.base import BaseTool
from tools.posthog.client import PostHogClient


ACTIONS = {
    "query_events": "이벤트 목록을 조회합니다.",
    "query_insights": "인사이트(분석 리포트)를 조회합니다.",
    "list_feature_flags": "기능 플래그 목록을 조회합니다.",
    "list_dashboards": "대시보드 목록을 조회합니다.",
    "get_dashboard": "특정 대시보드의 상세 정보와 포함된 인사이트를 조회합니다.",
    "query_hogql": "HogQL 쿼리를 실행합니다.",
    "list_persons": "사용자를 조회합니다.",
    "list_cohorts": "코호트(사용자 그룹) 목록을 조회합니다.",
    "list_experiments": "실험(A/B 테스트) 목록을 조회합니다.",
}


class PostHogTool(BaseTool):
    def __init__(self, client: PostHogClient):
        self._client = client

    @property
    def name(self) -> str:
        return "posthog"

    @property
    def description(self) -> str:
        return (
            "PostHog 분석 데이터를 조회합니다. "
            "이벤트, 인사이트, 기능 플래그, 대시보드, 사용자, 코호트, 실험, HogQL 쿼리를 지원합니다."
        )

    def get_schema(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": list(ACTIONS.keys()),
                            "description": "실행할 작업. " + " / ".join(f"{k}: {v}" for k, v in ACTIONS.items()),
                        },
                        "event": {
                            "type": "string",
                            "description": "조회할 이벤트 이름 (query_events에서 사용)",
                        },
                        "after": {
                            "type": "string",
                            "description": "조회 시작 일시 (ISO 8601, 예: 2025-01-01T00:00:00)",
                        },
                        "before": {
                            "type": "string",
                            "description": "조회 종료 일시 (ISO 8601, 예: 2025-12-31T23:59:59)",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "최대 조회 수 (기본값 100)",
                        },
                        "insight_id": {
                            "type": "string",
                            "description": "인사이트 ID (query_insights에서 특정 인사이트 조회 시 사용)",
                        },
                        "hogql": {
                            "type": "string",
                            "description": "실행할 HogQL 쿼리 (query_hogql에서 사용)",
                        },
                        "distinct_id": {
                            "type": "string",
                            "description": "사용자 식별자 (list_persons에서 사용)",
                        },
                        "email": {
                            "type": "string",
                            "description": "사용자 이메일 (list_persons에서 사용)",
                        },
                        "dashboard_id": {
                            "type": "string",
                            "description": "대시보드 ID (get_dashboard에서 사용)",
                        },
                    },
                    "required": ["action"],
                },
            },
        }

    def execute(self, params: dict) -> str:
        action = params.get("action", "")
        kwargs = {k: v for k, v in params.items() if k != "action" and v is not None}

        if action == "query_events":
            return self._client.query_events(**kwargs)
        elif action == "query_insights":
            return self._client.query_insights(**kwargs)
        elif action == "query_hogql":
            query = kwargs.get("hogql", "")
            if not query:
                return "hogql 파라미터가 필요합니다."
            return self._client.query_hogql(query=query)
        elif action == "list_feature_flags":
            return self._client.list_feature_flags()
        elif action == "list_dashboards":
            return self._client.list_dashboards()
        elif action == "get_dashboard":
            dashboard_id = kwargs.get("dashboard_id", "")
            if not dashboard_id:
                return "dashboard_id 파라미터가 필요합니다."
            return self._client.get_dashboard(dashboard_id=dashboard_id)
        elif action == "list_persons":
            return self._client.list_persons(**kwargs)
        elif action == "list_cohorts":
            return self._client.list_cohorts(**kwargs)
        elif action == "list_experiments":
            return self._client.list_experiments(**kwargs)
        else:
            available = ", ".join(ACTIONS.keys())
            return f"알 수 없는 작업 '{action}'입니다. 사용 가능: {available}"
