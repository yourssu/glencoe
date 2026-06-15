import { logger } from "../../logger.js";

const POSTHOG_API_BASE = "https://app.posthog.com/api";

export interface PostHogClientEntry {
  name: string;
  projectId: string;
  description: string;
}

function truncate(text: string, maxLen = 4000): string {
  if (text.length > maxLen) {
    return text.slice(0, maxLen) + "\n... (결과가 너무 길어 잘렸습니다)";
  }
  return text;
}

export class PostHogClient {
  private headers: Record<string, string>;
  private projectId: string;

  constructor(apiKey: string, projectId: string) {
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    this.projectId = projectId;
  }

  private projectUrl(resource: string): string {
    return `${POSTHOG_API_BASE}/projects/${this.projectId}/${resource}/`;
  }

  async queryEvents(params: {
    event?: string;
    after?: string;
    before?: string;
    limit?: number;
  }): Promise<string> {
    const query = new URLSearchParams();
    if (params.event) query.set("event", params.event);
    if (params.after) query.set("after", params.after);
    if (params.before) query.set("before", params.before);
    query.set("limit", String(params.limit ?? 100));
    return this.get(`${this.projectUrl("events")}?${query.toString()}`);
  }

  async queryInsights(insightId?: string): Promise<string> {
    const url = insightId
      ? `${this.projectUrl("insights")}${insightId}/`
      : this.projectUrl("insights");
    return this.get(url);
  }

  async listFeatureFlags(): Promise<string> {
    return this.get(this.projectUrl("feature_flags"));
  }

  async listDashboards(): Promise<string> {
    return this.get(this.projectUrl("dashboards"));
  }

  async getDashboard(dashboardId: string): Promise<string> {
    return this.get(`${this.projectUrl("dashboards")}${dashboardId}/`);
  }

  async queryHogQL(query: string): Promise<string> {
    return this.post(this.projectUrl("query"), {
      query: { kind: "HogQLQuery", query },
    });
  }

  async listPersons(params: {
    distinctId?: string;
    email?: string;
    limit?: number;
  }): Promise<string> {
    const query = new URLSearchParams();
    if (params.distinctId) query.set("distinct_id", params.distinctId);
    if (params.email) query.set("email", params.email);
    query.set("limit", String(params.limit ?? 100));
    return this.get(`${this.projectUrl("persons")}?${query.toString()}`);
  }

  async listCohorts(limit = 100): Promise<string> {
    return this.get(`${this.projectUrl("cohorts")}?limit=${limit}`);
  }

  async listExperiments(limit = 100): Promise<string> {
    return this.get(`${this.projectUrl("experiments")}?limit=${limit}`);
  }

  private async get(url: string): Promise<string> {
    try {
      const resp = await fetch(url, {
        headers: this.headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        logger.error(`PostHog API error: ${resp.status}`);
        return `PostHog API 요청에 실패했습니다. (status=${resp.status})`;
      }
      return truncate(await resp.text());
    } catch (e) {
      logger.error("PostHog API request failed:", e);
      return "PostHog API 요청 중 오류가 발생했습니다.";
    }
  }

  private async post(url: string, body: unknown): Promise<string> {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        logger.error(`PostHog API error: ${resp.status}`);
        return `PostHog API 요청에 실패했습니다. (status=${resp.status})`;
      }
      return truncate(await resp.text());
    } catch (e) {
      logger.error("PostHog API request failed:", e);
      return "PostHog API 요청 중 오류가 발생했습니다.";
    }
  }
}

export class PostHogClientManager {
  private clients: Map<string, PostHogClient> = new Map();
  private entries: PostHogClientEntry[];
  private defaultName: string;

  constructor(apiKey: string, entries: PostHogClientEntry[]) {
    if (entries.length === 0) {
      throw new Error("PostHogClientManager는 최소 1개의 entries가 필요합니다");
    }
    this.entries = entries;
    this.defaultName = entries[0].name;
    for (const e of entries) {
      this.clients.set(e.name, new PostHogClient(apiKey, e.projectId));
    }
  }

  getClient(projectName?: string): PostHogClient {
    const name = projectName ?? this.defaultName;
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(
        `알 수 없는 PostHog 프로젝트: "${name}". 사용 가능: ${this.getProjectNames().join(", ")}`
      );
    }
    return client;
  }

  getProjectNames(): string[] {
    return this.entries.map((p) => p.name);
  }

  getProjectCatalog(): string {
    return this.entries
      .map((p) => `- **${p.name}**: ${p.description}`)
      .join("\n");
  }

  getDefaultName(): string {
    return this.defaultName;
  }
}
