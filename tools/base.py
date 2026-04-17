from abc import ABC, abstractmethod


class BaseTool(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        ...

    @abstractmethod
    def get_schema(self) -> dict:
        ...

    @abstractmethod
    def execute(self, params: dict) -> str:
        ...
