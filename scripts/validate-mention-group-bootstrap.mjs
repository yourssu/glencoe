#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const HANDLE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/u;
const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{1,20}$/u;
const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "channel",
  "everyone",
  "here",
  "internal",
  "shookie",
  "slack",
]);
const LEGACY_BASE_HANDLES = [
  "be",
  "fe",
  "android",
  "ios",
  "design",
  "pm",
  "marketing",
  "hr",
  "finance",
  "lead",
  "vicelead",
  "legal",
];
const REQUIRED_LEGACY_HANDLES = new Set(
  LEGACY_BASE_HANDLES.flatMap((handle) => [
    handle,
    `${handle}-all`,
    `${handle}-non-active`,
  ]),
);

const inputPath = process.argv[2];
const requireLegacyParity = process.argv.includes("--require-legacy-parity");

if (!inputPath || inputPath.startsWith("--")) {
  fail(
    "usage: node scripts/validate-mention-group-bootstrap.mjs <inventory.json> [--require-legacy-parity]",
  );
}

let raw;
let inventory;
try {
  raw = await readFile(inputPath);
  inventory = JSON.parse(raw.toString("utf8"));
} catch (error) {
  fail(`unable to read valid JSON: ${error instanceof Error ? error.message : "unknown error"}`);
}

assertPlainObject(inventory, "inventory");
assertExactKeys(inventory, ["schemaVersion", "source", "groups"], "inventory");
assert(inventory.schemaVersion === 1, "inventory.schemaVersion must equal 1");
assertPlainObject(inventory.source, "inventory.source");
assertExactKeys(
  inventory.source,
  ["repository", "commit", "frozenAt"],
  "inventory.source",
);
assert(
  inventory.source.repository === "yourssu/mention-bot",
  "inventory.source.repository must equal yourssu/mention-bot",
);
assert(
  typeof inventory.source.commit === "string" &&
    /^[0-9a-f]{40}$/u.test(inventory.source.commit),
  "inventory.source.commit must be a full lowercase Git commit",
);
assert(
  typeof inventory.source.frozenAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(inventory.source.frozenAt) &&
    Number.isFinite(Date.parse(inventory.source.frozenAt)),
  "inventory.source.frozenAt must be an ISO-8601 UTC timestamp",
);
assert(Array.isArray(inventory.groups), "inventory.groups must be an array");
assert(inventory.groups.length > 0, "inventory.groups must not be empty");

const occupiedHandles = new Map();
const primaryHandles = new Set();
let activeGroupCount = 0;
let memberReferenceCount = 0;

for (const [index, group] of inventory.groups.entries()) {
  const location = `inventory.groups[${index}]`;
  assertPlainObject(group, location);
  assertExactKeys(
    group,
    ["handle", "displayName", "description", "aliases", "memberUserIds", "active"],
    location,
  );
  validateHandle(group.handle, `${location}.handle`);
  assert(!primaryHandles.has(group.handle), `${location}.handle duplicates ${group.handle}`);
  primaryHandles.add(group.handle);

  assert(
    typeof group.displayName === "string" &&
      group.displayName.trim().length > 0 &&
      group.displayName.length <= 100,
    `${location}.displayName must contain 1-100 characters`,
  );
  assert(
    group.description === null ||
      (typeof group.description === "string" && group.description.length <= 500),
    `${location}.description must be null or at most 500 characters`,
  );
  assert(Array.isArray(group.aliases), `${location}.aliases must be an array`);
  assert(
    Array.isArray(group.memberUserIds),
    `${location}.memberUserIds must be an array`,
  );
  assert(typeof group.active === "boolean", `${location}.active must be boolean`);

  claimHandle(group.handle, `${location}.handle`);
  const localAliases = new Set();
  for (const [aliasIndex, alias] of group.aliases.entries()) {
    const aliasLocation = `${location}.aliases[${aliasIndex}]`;
    validateHandle(alias, aliasLocation);
    assert(alias !== group.handle, `${aliasLocation} duplicates its primary handle`);
    assert(!localAliases.has(alias), `${aliasLocation} is duplicated in the group`);
    localAliases.add(alias);
    claimHandle(alias, aliasLocation);
  }

  const localMembers = new Set();
  for (const [memberIndex, memberUserId] of group.memberUserIds.entries()) {
    const memberLocation = `${location}.memberUserIds[${memberIndex}]`;
    assert(
      typeof memberUserId === "string" && SLACK_USER_ID_PATTERN.test(memberUserId),
      `${memberLocation} is not a valid Slack user ID`,
    );
    assert(!localMembers.has(memberUserId), `${memberLocation} is duplicated in the group`);
    localMembers.add(memberUserId);
  }

  if (group.active) activeGroupCount += 1;
  memberReferenceCount += group.memberUserIds.length;
}

const missingLegacyHandles = [...REQUIRED_LEGACY_HANDLES]
  .filter((handle) => !primaryHandles.has(handle))
  .sort();
const inactiveLegacyHandles = inventory.groups
  .filter((group) => REQUIRED_LEGACY_HANDLES.has(group.handle) && !group.active)
  .map((group) => group.handle)
  .sort();

if (requireLegacyParity) {
  assert(
    missingLegacyHandles.length === 0,
    `missing legacy primary handles: ${missingLegacyHandles.join(", ")}`,
  );
  assert(
    inactiveLegacyHandles.length === 0,
    `legacy compatibility groups must be active: ${inactiveLegacyHandles.join(", ")}`,
  );
}

console.log(
  JSON.stringify(
    {
      sha256: createHash("sha256").update(raw).digest("hex"),
      groupCount: inventory.groups.length,
      activeGroupCount,
      customGroupCount: inventory.groups.filter(
        (group) => !REQUIRED_LEGACY_HANDLES.has(group.handle),
      ).length,
      uniqueHandleAndAliasCount: occupiedHandles.size,
      memberReferenceCount,
      legacyParityRequired: requireLegacyParity,
      missingLegacyHandleCount: missingLegacyHandles.length,
      inactiveLegacyHandleCount: inactiveLegacyHandles.length,
    },
    null,
    2,
  ),
);

function validateHandle(handle, location) {
  assert(
    typeof handle === "string" && HANDLE_PATTERN.test(handle),
    `${location} must match ${HANDLE_PATTERN}`,
  );
  assert(!RESERVED_HANDLES.has(handle), `${location} is reserved by Radar`);
}

function claimHandle(handle, location) {
  const existing = occupiedHandles.get(handle);
  assert(!existing, `${location} conflicts with ${existing}`);
  occupiedHandles.set(handle, location);
}

function assertPlainObject(value, location) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${location} must be an object`,
  );
}

function assertExactKeys(value, expectedKeys, location) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  assert(
    JSON.stringify(actualKeys) === JSON.stringify(sortedExpectedKeys),
    `${location} keys must be exactly: ${sortedExpectedKeys.join(", ")}`,
  );
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`mention-group bootstrap inventory invalid: ${message}`);
  process.exit(1);
}
