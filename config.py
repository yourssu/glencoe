from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Slack
    slack_bot_token: str
    slack_app_token: str

    # LLM
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1/"
    model: str = "gpt-5-nano"

    # Tools (optional - tools are disabled if not set)
    notion_api_key: str = ""
    github_token: str = ""
    posthog_api_key: str = ""
    posthog_project_id: str = ""
    linear_api_key: str = ""

    # Agent
    max_tool_iterations: int = 8
    max_history_messages: int = 30

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
