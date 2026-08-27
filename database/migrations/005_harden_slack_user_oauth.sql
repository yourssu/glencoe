-- Revoke any pre-existing row that violates the least-privilege or rotation
-- invariants before enforcing them at the database boundary.
UPDATE slack_user_oauth_tokens
SET encrypted_access_token = 'revoked',
    encrypted_refresh_token = NULL,
    scopes = '{}',
    expires_at = NULL,
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE revoked_at IS NULL
  AND (
    btrim(team_id) = ''
    OR btrim(user_id) = ''
    OR encrypted_access_token NOT LIKE 'v1:%'
    OR scopes <> ARRAY['chat:write']::TEXT[]
    OR ((encrypted_refresh_token IS NULL) <> (expires_at IS NULL))
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'slack_user_oauth_tokens_active_invariants'
      AND conrelid = 'slack_user_oauth_tokens'::regclass
  ) THEN
    ALTER TABLE slack_user_oauth_tokens
      ADD CONSTRAINT slack_user_oauth_tokens_active_invariants CHECK (
        revoked_at IS NOT NULL
        OR (
          btrim(team_id) <> ''
          AND btrim(user_id) <> ''
          AND encrypted_access_token LIKE 'v1:%'
          AND scopes = ARRAY['chat:write']::TEXT[]
          AND ((encrypted_refresh_token IS NULL) = (expires_at IS NULL))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'slack_oauth_states_valid_shape'
      AND conrelid = 'slack_oauth_states'::regclass
  ) THEN
    ALTER TABLE slack_oauth_states
      ADD CONSTRAINT slack_oauth_states_valid_shape CHECK (
        state_hash ~ '^[0-9a-f]{64}$'
        AND btrim(team_id) <> ''
        AND btrim(user_id) <> ''
        AND jsonb_typeof(context) = 'object'
        AND expires_at > created_at
      );
  END IF;
END
$$;
