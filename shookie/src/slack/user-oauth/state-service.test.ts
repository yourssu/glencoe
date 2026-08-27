import { describe, expect, it, vi } from "vitest";
import type { SlackOAuthStateRecord } from "database";
import { SlackOAuthStateService, type SlackOAuthStateRepository } from "./state-service.js";

class MemoryStateRepository implements SlackOAuthStateRepository {
  records = new Map<string, Omit<SlackOAuthStateRecord, "createdAt">>();

  async create(state: Omit<SlackOAuthStateRecord, "createdAt">): Promise<void> {
    this.records.set(state.stateHash, state);
  }

  async consume(stateHash: string): Promise<SlackOAuthStateRecord | null> {
    const state = this.records.get(stateHash);
    if (!state) return null;
    this.records.delete(stateHash);
    return { ...state, createdAt: new Date(0) };
  }
}

describe("SlackOAuthStateService", () => {
  it("원문 state 대신 해시를 저장하고 한 번만 소비한다", async () => {
    const repository = new MemoryStateRepository();
    const service = new SlackOAuthStateService(repository, 60_000, () => 1_000);

    const state = await service.create({
      teamId: "T123",
      userId: "U123",
      context: { channelId: "C123", messageTs: "100.200" },
    });

    const [storedHash, stored] = [...repository.records.entries()][0] ?? [];
    expect(state).toHaveLength(43);
    expect(storedHash).not.toBe(state);
    expect(stored?.expiresAt).toEqual(new Date(61_000));
    await expect(service.consume(state)).resolves.toEqual({
      teamId: "T123",
      userId: "U123",
      context: { channelId: "C123", messageTs: "100.200" },
    });
    await expect(service.consume(state)).resolves.toBeNull();
  });

  it("정규 형식이 아닌 state는 DB 조회 없이 거부한다", async () => {
    const repository = new MemoryStateRepository();
    const service = new SlackOAuthStateService(repository);
    const consume = vi.spyOn(repository, "consume");

    await expect(service.consume("xoxp-sensitive-token")).resolves.toBeNull();
    expect(consume).not.toHaveBeenCalled();
  });

  it("과도하게 큰 후속 처리 context를 저장하지 않는다", async () => {
    const repository = new MemoryStateRepository();
    const service = new SlackOAuthStateService(repository);

    await expect(
      service.create({
        teamId: "T123",
        userId: "U123",
        context: { channelId: "C".repeat(5_000) },
      }),
    ).rejects.toThrow("too large");
    expect(repository.records.size).toBe(0);
  });
});
