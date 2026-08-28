import { getPool } from "./pool.js";

export interface SlackOAuthStateRecord {
  stateHash: string;
  teamId: string;
  userId: string;
  context: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
}

interface SlackOAuthStateRow {
  state_hash: string;
  team_id: string;
  user_id: string;
  context: Record<string, unknown>;
  expires_at: Date;
  created_at: Date;
}

function mapStateRow(row: SlackOAuthStateRow): SlackOAuthStateRecord {
  return {
    stateHash: row.state_hash,
    teamId: row.team_id,
    userId: row.user_id,
    context: row.context,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export async function createSlackOAuthState(
  state: Omit<SlackOAuthStateRecord, "createdAt">,
): Promise<void> {
  await getPool().query(
    `INSERT INTO slack_oauth_states (state_hash, team_id, user_id, context, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [state.stateHash, state.teamId, state.userId, state.context, state.expiresAt],
  );
}

/** Atomically consumes a non-expired state. A replay receives null. */
export async function consumeSlackOAuthState(stateHash: string): Promise<SlackOAuthStateRecord | null> {
  const result = await getPool().query<SlackOAuthStateRow>(
    `DELETE FROM slack_oauth_states
     WHERE state_hash = $1 AND expires_at > now()
     RETURNING state_hash, team_id, user_id, context, expires_at, created_at`,
    [stateHash],
  );
  const row = result.rows[0];
  return row ? mapStateRow(row) : null;
}

export async function deleteExpiredSlackOAuthStates(): Promise<number> {
  const result = await getPool().query(`DELETE FROM slack_oauth_states WHERE expires_at <= now()`);
  return result.rowCount ?? 0;
}
