import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const ENVELOPE_VERSION = "v1";

export type SlackTokenKind = "access" | "refresh";

export interface SlackTokenIdentity {
  teamId: string;
  userId: string;
  kind: SlackTokenKind;
}

function buildAdditionalAuthenticatedData(identity: SlackTokenIdentity): Buffer {
  return Buffer.from(`slack-user-token\0${identity.teamId}\0${identity.userId}\0${identity.kind}`);
}

function decodeEnvelopePart(value: string, expectedLength?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid encrypted Slack token envelope");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new Error("Invalid encrypted Slack token envelope");
  }
  return decoded;
}

export class TokenCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_LENGTH) {
      throw new Error("Slack token encryption key must be exactly 32 bytes");
    }
    this.key = Buffer.from(key);
  }

  static fromBase64Key(encodedKey: string): TokenCipher {
    if (!encodedKey) throw new Error("SLACK_TOKEN_ENCRYPTION_KEY is required");
    const key = Buffer.from(encodedKey, "base64");
    if (key.toString("base64").replace(/=+$/u, "") !== encodedKey.replace(/=+$/u, "")) {
      throw new Error("SLACK_TOKEN_ENCRYPTION_KEY must be valid base64");
    }
    return new TokenCipher(key);
  }

  encrypt(token: string, identity: SlackTokenIdentity): string {
    if (!token) throw new Error("Cannot encrypt an empty Slack token");

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(buildAdditionalAuthenticatedData(identity));
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      ENVELOPE_VERSION,
      iv.toString("base64url"),
      authTag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(":");
  }

  decrypt(envelope: string, identity: SlackTokenIdentity): string {
    const [version, ivPart, authTagPart, ciphertextPart, extraPart] = envelope.split(":");
    if (
      version !== ENVELOPE_VERSION ||
      !ivPart ||
      !authTagPart ||
      !ciphertextPart ||
      extraPart !== undefined
    ) {
      throw new Error("Invalid encrypted Slack token envelope");
    }

    try {
      const iv = decodeEnvelopePart(ivPart, IV_LENGTH);
      const authTag = decodeEnvelopePart(authTagPart, 16);
      const ciphertext = decodeEnvelopePart(ciphertextPart);
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAAD(buildAdditionalAuthenticatedData(identity));
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch {
      throw new Error("Unable to decrypt Slack token");
    }
  }
}
