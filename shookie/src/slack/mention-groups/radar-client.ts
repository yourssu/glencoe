import { z } from "zod";
import { logger } from "../../logger.js";
import { buildMentionGroupIndex } from "./parser.js";
import type { ActiveMentionGroup, MentionGroupCatalog } from "./types.js";

const MAX_RESPONSE_BYTES = 1_048_576;
const HANDLE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/u;
const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{1,20}$/u;

const groupSchema = z
  .object({
    id: z.string().uuid(),
    handle: z.string().regex(HANDLE_PATTERN),
    aliases: z.array(z.string().regex(HANDLE_PATTERN)).max(100),
    memberUserIds: z.array(z.string().regex(SLACK_USER_ID_PATTERN)).max(5_000),
  })
  .strict()
  .superRefine((group, context) => {
    const handles = [group.handle, ...group.aliases];
    if (new Set(handles).size !== handles.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate handle or alias" });
    }
    if (new Set(group.memberUserIds).size !== group.memberUserIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate member" });
    }
  });

const catalogSchema = z
  .object({
    revision: z.number().int().nonnegative().safe(),
    groups: z.array(groupSchema).max(5_000),
  })
  .strict()
  .superRefine((catalog, context) => {
    const owners = new Map<string, string>();
    const groupIds = new Set<string>();
    for (const group of catalog.groups) {
      if (groupIds.has(group.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate group id" });
      }
      groupIds.add(group.id);
      for (const handle of [group.handle, ...group.aliases]) {
        const owner = owners.get(handle);
        if (owner && owner !== group.id) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `handle namespace collision: ${handle}`,
          });
        }
        owners.set(handle, group.id);
      }
    }
  });

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RadarMentionGroupsClientOptions {
  apiUrl: string;
  apiKey: string;
  cacheTtlMs: number;
  requestTimeoutMs: number;
  fetcher?: Fetcher;
  now?: () => number;
}

interface CachedCatalog {
  catalog: MentionGroupCatalog;
  fingerprint: string;
  expiresAt: number;
}

export class RadarMentionGroupsError extends Error {
  constructor(readonly code: string) {
    super(`Radar mention groups request failed: ${code}`);
    this.name = "RadarMentionGroupsError";
  }
}

/**
 * Revision-aware, single-flight cache for Radar's SPR-128 internal contract.
 * Once a cache entry expires, a failed revalidation fails closed instead of
 * using old membership and potentially mentioning somebody who was removed.
 */
export class RadarMentionGroupsClient {
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private cached: CachedCatalog | null = null;
  private refreshInFlight: Promise<MentionGroupCatalog> | null = null;

  constructor(private readonly options: RadarMentionGroupsClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getCatalog(): Promise<MentionGroupCatalog> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.catalog;
    if (this.refreshInFlight) return this.refreshInFlight;

    const refresh = this.refresh().finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null;
    });
    this.refreshInFlight = refresh;
    return refresh;
  }

  private async refresh(): Promise<MentionGroupCatalog> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.requestTimeoutMs);

    let response: Response;
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Radar-Internal-Key": this.options.apiKey,
      };
      if (this.cached) headers["If-None-Match"] = this.cached.catalog.etag;
      response = await this.fetcher(this.options.apiUrl, {
        method: "GET",
        headers,
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      throw new RadarMentionGroupsError(timedOut ? "timeout" : "network_error");
    }

    try {
      if (response.status === 304) {
        if (!this.cached) throw new RadarMentionGroupsError("unexpected_not_modified");
        if (!isEquivalentEntityTag(response.headers.get("etag"), this.cached.catalog.etag)) {
          throw new RadarMentionGroupsError("invalid_not_modified_etag");
        }
        this.cached.expiresAt = this.now() + this.options.cacheTtlMs;
        return this.cached.catalog;
      }
      if (response.status !== 200) {
        throw new RadarMentionGroupsError(`http_${response.status}`);
      }

      let rawBody: string;
      try {
        rawBody = await response.text();
      } catch {
        throw new RadarMentionGroupsError(timedOut ? "timeout" : "network_error");
      }
      if (Buffer.byteLength(rawBody, "utf8") > MAX_RESPONSE_BYTES) {
        throw new RadarMentionGroupsError("response_too_large");
      }

      let rawCatalog: unknown;
      try {
        rawCatalog = JSON.parse(rawBody);
      } catch {
        throw new RadarMentionGroupsError("invalid_json");
      }
      const parsed = catalogSchema.safeParse(rawCatalog);
      if (!parsed.success) throw new RadarMentionGroupsError("invalid_schema");

      const expectedEtag = `"mention-groups-${parsed.data.revision}"`;
      if (!isEquivalentEntityTag(response.headers.get("etag"), expectedEtag)) {
        throw new RadarMentionGroupsError("invalid_etag");
      }

      const groups = parsed.data.groups as ActiveMentionGroup[];
      const fingerprint = catalogFingerprint(groups);
      if (this.cached) {
        const previousRevision = this.cached.catalog.revision;
        if (parsed.data.revision < previousRevision) {
          throw new RadarMentionGroupsError("revision_rollback");
        }
        if (
          parsed.data.revision === previousRevision &&
          fingerprint !== this.cached.fingerprint
        ) {
          throw new RadarMentionGroupsError("revision_content_mismatch");
        }
      }

      const catalog: MentionGroupCatalog = {
        revision: parsed.data.revision,
        etag: expectedEtag,
        groups,
        byHandle: buildMentionGroupIndex(groups),
      };
      this.cached = {
        catalog,
        fingerprint,
        expiresAt: this.now() + this.options.cacheTtlMs,
      };
      logger.info("Radar 멘션 그룹 캐시 갱신", {
        revision: catalog.revision,
        groupCount: catalog.groups.length,
      });
      return catalog;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isEquivalentEntityTag(actual: string | null, expectedStrong: string): boolean {
  return actual === expectedStrong || actual === `W/${expectedStrong}`;
}

function catalogFingerprint(groups: ActiveMentionGroup[]): string {
  return JSON.stringify(
    groups
      .map((group) => ({
        id: group.id,
        handle: group.handle,
        aliases: [...group.aliases].sort(),
        memberUserIds: [...group.memberUserIds].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}
