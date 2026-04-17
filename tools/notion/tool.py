from tools.base import BaseTool
from tools.notion.client import NotionClient


class NotionTool(BaseTool):
    def __init__(self, api_key: str):
        self._client = NotionClient(api_key)

    @property
    def name(self) -> str:
        return "search_notion"

    @property
    def description(self) -> str:
        return (
            "Search the company wiki and documentation in Notion. "
            "Use this when the user asks about company policies, product specs, "
            "meeting notes, planning documents, or any internal documentation."
        )

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query in Korean or English",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results to return (default 5)",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        }

    def execute(self, params: dict) -> str:
        query = params["query"]
        limit = params.get("limit", 5)
        return self._client.search(query, limit)
