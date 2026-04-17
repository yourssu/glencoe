import httpx


class NotionClient:
    BASE_URL = "https://api.notion.com/v1"

    def __init__(self, api_key: str):
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        }

    def search(self, query: str, limit: int = 5) -> str:
        try:
            response = httpx.post(
                f"{self.BASE_URL}/search",
                headers=self._headers,
                json={
                    "query": query,
                    "page_size": limit,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPError as e:
            return f"Notion API error: {e}"

        results = data.get("results", [])
        if not results:
            return f"'{query}'에 대한 검색 결과가 없습니다."

        parts = []
        for page in results:
            title = self._extract_title(page)
            url = page.get("url", "")
            parts.append(f"- **{title}**\n  {url}")

        return "\n".join(parts)

    def _extract_title(self, page: dict) -> str:
        props = page.get("properties", {})
        for prop in props.values():
            if prop.get("type") == "title":
                titles = prop.get("title", [])
                if titles:
                    return titles[0].get("plain_text", "Untitled")
        return "Untitled"
