import { getPool } from "./pool.js";

export interface SlackUserOAuthTokenRecord {
  teamId: string;
  userId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveSlackUserOAuthToken {
  teamId: string;
  userId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string | null;
  scopes: string[];
  expiresAt?: Date | null;
}

interface SlackUserOAuthTokenRow {
  team_id: string;
  user_id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  scopes: string[];
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapTokenRow(row: SlackUserOAuthTokenRow): SlackUserOAuthTokenRecord {
  return {
    teamId: row.team_id,
    userId: row.user_id,
    encryptedAccessToken: row.encrypted_access_token,
    encryptedRefreshToken: row.encrypted_refresh_token,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveSlackUserOAuthToken(
  record: SaveSlackUserOAuthToken,
): Promise<SlackUserOAuthTokenRecord> {
  const result = await getPool().query<SlackUserOAuthTokenRow>(
    `INSERT INTO slack_user_oauth_tokens (
       team_id, user_id, encrypted_access_token, encrypted_refresh_token, scopes, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (team_id, user_id) DO UPDATE
     SET encrypted_access_token = EXCLUDED.encrypted_access_token,
         encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
         scopes = EXCLUDED.scopes,
         expires_at = EXCLUDED.expires_at,
         revoked_at = NULL,
         updated_at = now()
     RETURNING team_id, user_id, encrypted_access_token, encrypted_refresh_token,
               scopes, expires_at, created_at, updated_at`,
    [
      record.teamId,
      record.userId,
      record.encryptedAccessToken,
      record.encryptedRefreshToken ?? null,
      record.scopes,
      record.expiresAt ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error("Failed to save Slack user OAuth token");
  return mapTokenRow(row);
}

export async function getSlackUserOAuthToken(
  teamId: string,
  userId: string,
): Promise<SlackUserOAuthTokenRecord | null> {
  const result = await getPool().query<SlackUserOAuthTokenRow>(
    `SELECT team_id, user_id, encrypted_access_token, encrypted_refresh_token,
            scopes, expires_at, created_at, updated_at
     FROM slack_user_oauth_tokens
     WHERE team_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [teamId, userId],
  );
  const row = result.rows[0];
  return row ? mapTokenRow(row) : null;
}

/**
 * Replaces a rotated token only when the refresh token has not changed since it
 * was read. This prevents a slower concurrent refresh from overwriting the
 * winning refresh response.
 */
export async function replaceRotatedSlackUserOAuthToken(
  record: SaveSlackUserOAuthToken & { expectedEncryptedRefreshToken: string },
): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE slack_user_oauth_tokens
     SET encrypted_access_token = $4,
         encrypted_refresh_token = $5,
         scopes = $6,
         expires_at = $7,
         updated_at = now()
     WHERE team_id = $1
       AND user_id = $2
       AND encrypted_refresh_token = $3
       AND revoked_at IS NULL`,
    [
      record.teamId,
      record.userId,
      record.expectedEncryptedRefreshToken,
      record.encryptedAccessToken,
      record.encryptedRefreshToken ?? null,
      record.scopes,
      record.expiresAt ?? null,
    ],
  );
  return result.rowCount === 1;
}

export async function revokeSlackUserOAuthToken(teamId: string, userId: string): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE slack_user_oauth_tokens
     SET encrypted_access_token = 'revoked',
         encrypted_refresh_token = NULL,
         scopes = '{}',
         expires_at = NULL,
         revoked_at = now(),
         updated_at = now()
     WHERE team_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [teamId, userId],
  );
  return result.rowCount === 1;
}

/**
 * Revokes a token only when both stored ciphertexts still match the record that
 * was validated or refreshed. This prevents a stale failure from revoking a
 * newer OAuth grant written by another process.
 */
export async function revokeSlackUserOAuthTokenIfUnchanged(
  teamId: string,
  userId: string,
  expectedEncryptedAccessToken: string,
  expectedEncryptedRefreshToken: string | null,
): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE slack_user_oauth_tokens
     SET encrypted_access_token = 'revoked',
         encrypted_refresh_token = NULL,
         scopes = '{}',
         expires_at = NULL,
         revoked_at = now(),
         updated_at = now()
     WHERE team_id = $1
       AND user_id = $2
       AND encrypted_access_token = $3
       AND encrypted_refresh_token IS NOT DISTINCT FROM $4
       AND revoked_at IS NULL`,
    [teamId, userId, expectedEncryptedAccessToken, expectedEncryptedRefreshToken],
  );
  return result.rowCount === 1;
}

export async function deleteSlackUserOAuthToken(teamId: string, userId: string): Promise<boolean> {
  const result = await getPool().query(
    `DELETE FROM slack_user_oauth_tokens WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId],
  );
  return result.rowCount === 1;
}
