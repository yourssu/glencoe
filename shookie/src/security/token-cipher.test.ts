import { describe, expect, it } from "vitest";
import { TokenCipher } from "./token-cipher.js";

const identity = { teamId: "T123", userId: "U123", kind: "access" as const };

describe("TokenCipher", () => {
  it("토큰을 AES-GCM으로 암호화하고 복호화한다", () => {
    const cipher = new TokenCipher(Buffer.alloc(32, 7));
    const encrypted = cipher.encrypt("xoxp-secret-token", identity);

    expect(encrypted).not.toContain("xoxp-secret-token");
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(cipher.decrypt(encrypted, identity)).toBe("xoxp-secret-token");
  });

  it("같은 토큰도 매번 다른 암호문을 만든다", () => {
    const cipher = new TokenCipher(Buffer.alloc(32, 7));
    expect(cipher.encrypt("xoxp-secret-token", identity)).not.toBe(
      cipher.encrypt("xoxp-secret-token", identity),
    );
  });

  it("다른 사용자 또는 토큰 종류로는 복호화할 수 없다", () => {
    const cipher = new TokenCipher(Buffer.alloc(32, 7));
    const encrypted = cipher.encrypt("xoxp-secret-token", identity);

    expect(() => cipher.decrypt(encrypted, { ...identity, userId: "U999" })).toThrow(
      "Unable to decrypt Slack token",
    );
    expect(() => cipher.decrypt(encrypted, { ...identity, kind: "refresh" })).toThrow(
      "Unable to decrypt Slack token",
    );
  });

  it("32바이트가 아닌 키를 거부한다", () => {
    expect(() => new TokenCipher(Buffer.alloc(31))).toThrow("exactly 32 bytes");
    expect(() => TokenCipher.fromBase64Key("not-base64")).toThrow("valid base64");
  });

  it("비정상 IV/tag 길이와 변조된 envelope를 평문 노출 없이 거부한다", () => {
    const cipher = new TokenCipher(Buffer.alloc(32, 7));
    const encrypted = cipher.encrypt("xoxp-secret-token", identity);
    const [, , tag, ciphertext] = encrypted.split(":");
    const malformed = `v1:AA:${tag}:${ciphertext}`;

    expect(() => cipher.decrypt(malformed, identity)).toThrow("Unable to decrypt Slack token");
    try {
      cipher.decrypt(`${encrypted}tampered`, identity);
    } catch (error) {
      expect(String(error)).not.toContain("xoxp-secret-token");
      expect(String(error)).not.toContain(encrypted);
    }
  });
});
