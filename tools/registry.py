from __future__ import annotations

from tools.base import BaseTool


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        self._tools[tool.name] = tool

    def get_all_schemas(self) -> list[dict]:
        return [tool.get_schema() for tool in self._tools.values()]

    def get_tool(self, name: str) -> BaseTool | None:
        return self._tools.get(name)

    def execute(self, name: str, params: dict) -> str:
        tool = self.get_tool(name)
        if tool is None:
            return f"Error: Unknown tool '{name}'"
        try:
            return tool.execute(params)
        except Exception as e:
            return f"Error executing {name}: {e}"

    @property
    def tool_names(self) -> list[str]:
        return list(self._tools.keys())
