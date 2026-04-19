from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

POSTHOG_API_BASE = "https://app.posthog.com/api"


class PostHogClient:
    def __init__(self, api_key: str, project_id: str):
        self._api_key = api_key
        self._project_id = project_id
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _project_url(self, resource: str) -> str:
        return f"{POSTHOG_API_BASE}/projects/{self._project_id}/{resource}/"

    def query_events(
        self,
        event: str | None = None,
        after: str | None = None,
        before: str | None = None,
        limit: int = 100,
    ) -> str:
        params: dict = {"limit": limit}
        if event:
            params["event"] = event
        if after:
            params["after"] = after
        if before:
            params["before"] = before
        return self._get(self._project_url("events"), params)

    def query_insights(self, insight_id: str | None = None) -> str:
        if insight_id:
            url = f"{self._project_url('insights')}{insight_id}/"
        else:
            url = self._project_url("insights")
        return self._get(url)

    def list_feature_flags(self) -> str:
        return self._get(self._project_url("feature_flags"))

    def list_dashboards(self) -> str:
        return self._get(self._project_url("dashboards"))

    def get_dashboard(self, dashboard_id: str) -> str:
        return self._get(f"{self._project_url('dashboards')}{dashboard_id}/")

    def query_hogql(self, query: str) -> str:
        url = self._project_url("query")
        body = {"query": {"kind": "HogQLQuery", "query": query}}
        return self._post(url, body)

    def list_persons(
        self,
        distinct_id: str | None = None,
        email: str | None = None,
        limit: int = 100,
    ) -> str:
        params: dict = {"limit": limit}
        if distinct_id:
            params["distinct_id"] = distinct_id
        if email:
            params["email"] = email
        return self._get(self._project_url("persons"), params)

    def list_cohorts(self, limit: int = 100) -> str:
        return self._get(self._project_url("cohorts"), {"limit": limit})

    def list_experiments(self, limit: int = 100) -> str:
        return self._get(self._project_url("experiments"), {"limit": limit})

    def _get(self, url: str, params: dict | None = None) -> str:
        try:
            resp = httpx.get(url, headers=self._headers, params=params, timeout=30.0)
            resp.raise_for_status()
            return _truncate(resp.text)
        except httpx.HTTPStatusError as e:
            logger.error(f"PostHog API error: {e.response.status_code}")
            return f"PostHog API 요청에 실패했습니다. (status={e.response.status_code})"
        except Exception as e:
            logger.error(f"PostHog API request failed: {e}")
            return "PostHog API 요청 중 오류가 발생했습니다."

    def _post(self, url: str, body: dict) -> str:
        try:
            resp = httpx.post(url, headers=self._headers, json=body, timeout=30.0)
            resp.raise_for_status()
            return _truncate(resp.text)
        except httpx.HTTPStatusError as e:
            logger.error(f"PostHog API error: {e.response.status_code}")
            return f"PostHog API 요청에 실패했습니다. (status={e.response.status_code})"
        except Exception as e:
            logger.error(f"PostHog API request failed: {e}")
            return "PostHog API 요청 중 오류가 발생했습니다."


def _truncate(text: str, max_len: int = 4000) -> str:
    if len(text) > max_len:
        return text[:max_len] + "\n... (결과가 너무 길어 잘렸습니다)"
    return text
