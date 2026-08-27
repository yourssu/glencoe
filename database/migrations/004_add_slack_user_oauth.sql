CREATE TABLE IF NOT EXISTS slack_user_oauth_tokens (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_user_oauth_tokens_expires_at
    ON slack_user_oauth_tokens (expires_at)
    WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS slack_oauth_states (
    state_hash TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slack_oauth_states_expires_at
    ON slack_oauth_states (expires_at);
