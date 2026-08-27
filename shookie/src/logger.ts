type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";
const REDACTED = "[REDACTED]";
const SLACK_TOKEN_PATTERN = /\bxox[a-z0-9]*(?:\.[a-z0-9]+)?-[A-Za-z0-9._-]+\b/giu;
const AUTHORIZATION_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/giu;
const SECRET_PARAMETER_PATTERN =
  /([?&](?:access_token|refresh_token|token|client_secret|code|state)=)[^&#\s]*/giu;

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, msg: string): string {
  const ts = new Date().toISOString();
  return `${ts} [${level.toUpperCase()}] ${redactString(msg)}`;
}

function redactString(value: string): string {
  return value
    .replace(SLACK_TOKEN_PATTERN, REDACTED)
    .replace(AUTHORIZATION_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(SECRET_PARAMETER_PATTERN, `$1${REDACTED}`);
}

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return (
    normalized === "authorization" ||
    normalized === "code" ||
    normalized === "state" ||
    normalized === "token" ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("refreshtoken") ||
    normalized.endsWith("clientsecret") ||
    normalized.endsWith("encryptionkey")
  );
}

function redactValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Date) return value;
  if (depth >= 6) return "[Object]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
      ...(value.cause !== undefined
        ? { cause: redactValue(value.cause, seen, depth + 1) }
        : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, seen, depth + 1));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? REDACTED : redactValue(entry, seen, depth + 1);
  }
  return redacted;
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => {
    if (shouldLog("debug")) {
      console.log(formatMessage("debug", msg), ...args.map((arg) => redactValue(arg)));
    }
  },
  info: (msg: string, ...args: unknown[]) => {
    if (shouldLog("info")) {
      console.info(formatMessage("info", msg), ...args.map((arg) => redactValue(arg)));
    }
  },
  warn: (msg: string, ...args: unknown[]) => {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", msg), ...args.map((arg) => redactValue(arg)));
    }
  },
  error: (msg: string, ...args: unknown[]) => {
    if (shouldLog("error")) {
      console.error(formatMessage("error", msg), ...args.map((arg) => redactValue(arg)));
    }
  },
};
