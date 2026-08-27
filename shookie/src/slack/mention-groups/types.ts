export interface ActiveMentionGroup {
  id: string;
  handle: string;
  aliases: string[];
  memberUserIds: string[];
}

export interface MentionGroupCatalog {
  revision: number;
  etag: string;
  groups: ActiveMentionGroup[];
  byHandle: ReadonlyMap<string, ActiveMentionGroup>;
}
