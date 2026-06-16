-- 에이전트 실행 이력 상세 로깅을 위한 테이블 추가
-- sessions: Slack 스레드 단위 세션
-- agent_invocations: 에이전트별 실행 단위 (메인 1 + 서브 N)
-- tool_calls: 각 invocation 내 step별 도구 호출

-- 1. sessions
CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  session_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions (last_active_at DESC);

-- 2. agent_calls 확장 (기존 칼럼 유지, session_id만 추가)
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS session_id BIGINT REFERENCES sessions(id);
CREATE INDEX IF NOT EXISTS idx_agent_calls_session ON agent_calls (session_id, created_at DESC);

-- 3. agent_invocations
CREATE TABLE IF NOT EXISTS agent_invocations (
  id BIGSERIAL PRIMARY KEY,
  agent_call_id BIGINT NOT NULL REFERENCES agent_calls(id) ON DELETE CASCADE,
  parent_invocation_id BIGINT REFERENCES agent_invocations(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL CHECK (agent_name IN ('main-shookie', 'posthog', 'code-explorer')),
  task TEXT,
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  error TEXT,
  finish_reason TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cached_input_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_invocations_call ON agent_invocations (agent_call_id, started_at);
CREATE INDEX IF NOT EXISTS idx_invocations_parent ON agent_invocations (parent_invocation_id);
CREATE INDEX IF NOT EXISTS idx_invocations_errors ON agent_invocations (agent_name) WHERE status = 'error';

-- 4. tool_calls
CREATE TABLE IF NOT EXISTS tool_calls (
  id BIGSERIAL PRIMARY KEY,
  invocation_id BIGINT NOT NULL REFERENCES agent_invocations(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  input JSONB,
  output JSONB,
  output_size_bytes INTEGER,
  output_truncated BOOLEAN NOT NULL DEFAULT false,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_invocation ON tool_calls (invocation_id, step_index);
CREATE INDEX IF NOT EXISTS idx_tool_calls_errors ON tool_calls (tool_name) WHERE error IS NOT NULL;

-- 5. 기존 agent_calls 행을 session 단위로 묶어 sessions에 upsert
INSERT INTO sessions (session_key, user_id, channel, thread_ts, created_at, last_active_at, message_count)
SELECT
  channel || ':' || thread_ts,
  MIN(user_id),
  channel,
  thread_ts,
  MIN(created_at),
  MAX(created_at),
  COUNT(*)
FROM agent_calls
GROUP BY channel, thread_ts
ON CONFLICT (session_key) DO NOTHING;

-- 6. agent_calls.session_id 백필
UPDATE agent_calls ac
SET session_id = s.id
FROM sessions s
WHERE ac.channel = s.channel
  AND ac.thread_ts = s.thread_ts
  AND ac.session_id IS NULL;
