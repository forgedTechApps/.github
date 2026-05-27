import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Finding } from "./check-ci.js";
import type { AgentStandards } from "./standards.js";

const exec = promisify(execCb);

/**
 * Log-PII check (Increment 10.3).
 *
 * Scans log statements for references to sensitive field names. Imperfect
 * by nature — strings are dynamic, log statements can use indirect data —
 * but catches the obvious cases:
 *
 *   log.info({ password })            → flagged
 *   logger.info(`auth=${token}`)      → flagged
 *   console.log("user:", email)       → flagged
 *
 * Logger calls detected (regex):
 *   - TS/JS:  log[.{xxx}], logger[.{xxx}], console.{log,warn,error,debug,info}
 *   - Python: logger[.{xxx}], logging[.{xxx}], print(
 *
 * Sensitive-field defaults:
 *   password, secret, token, apiKey, api_key, sessionId, session_id,
 *   email, ssn, accountNumber, account_number, creditCard, credit_card,
 *   pin, dob, date_of_birth, address, phone, jwt, refresh_token
 *
 * Project override via architecture.log_pii_extra_fields. False positives
 * suppressed via inline '// agent-standards: allow-log-field <reason>'.
 *
 * Ships at severity: warn. Promote to error per project after cleanup.
 */

const LOGGER_CALL = /(?:\bconsole\.(?:log|warn|error|debug|info|trace)\b|\blog(?:ger)?\.\w+\b|\blogging\.\w+\b|\bprint\s*\()/;

const DEFAULT_SENSITIVE_FIELDS = [
  // auth
  "password", "passwd", "secret", "token", "apiKey", "api_key",
  "sessionId", "session_id", "jwt", "refreshToken", "refresh_token",
  "accessToken", "access_token", "authorization", "auth_token",
  // PII identity
  "email", "ssn", "national_id", "nationalId", "dob", "dateOfBirth", "date_of_birth",
  // financial
  "accountNumber", "account_number", "creditCard", "credit_card",
  "cvv", "cvc", "pin", "iban", "routing_number",
  // contact
  "phone", "phoneNumber", "phone_number", "address",
];

const SKIP_DIRS = /\/(?:node_modules|dist|build|\.next|coverage|__pycache__|\.venv|venv|migrations)\//;
const SKIP_FILES = /\.test\.|\.spec\.|test_|_test\.py$/;

interface LogPiiHit {
  file: string;
  line: number;
  matchedFields: string[];
  preview: string;
}

async function listTrackedSourceFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git ls-files", { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
    return stdout
      .split("\n")
      .filter((f) => /\.(ts|tsx|js|mjs|cjs|jsx|py)$/.test(f))
      .filter((f) => !SKIP_DIRS.test(f))
      .filter((f) => !SKIP_FILES.test(f));
  } catch {
    return [];
  }
}

function buildFieldPattern(fields: string[]): RegExp {
  // Match field names as identifiers in object shorthand, key:value, or template-literal context.
  // \b name \b handles most cases; we additionally accept the name preceded by `.` or quotes.
  const escaped = fields.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![A-Za-z0-9_])(${escaped.join("|")})(?![A-Za-z0-9_])`, "g");
}

export async function checkLogPii(
  repoRoot: string,
  standards: AgentStandards
): Promise<Finding[]> {
  const extra = (standards.architecture as { log_pii_extra_fields?: string[] } | undefined)?.log_pii_extra_fields ?? [];
  const fields = Array.from(new Set([...DEFAULT_SENSITIVE_FIELDS, ...extra]));
  const fieldPattern = buildFieldPattern(fields);

  const files = await listTrackedSourceFiles(repoRoot);
  if (files.length === 0) {
    return [{ severity: "info", code: "LOG_PII_NO_FILES", message: "No tracked source files matched." }];
  }

  const hits: LogPiiHit[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    // Pre-filter: only files containing a logger call at all
    if (!LOGGER_CALL.test(content)) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      if (!LOGGER_CALL.test(line)) continue;
      if (line.includes("agent-standards: allow-log-field")) continue;

      fieldPattern.lastIndex = 0;
      const matched = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = fieldPattern.exec(line)) !== null) {
        if (m[1]) matched.add(m[1]);
      }
      if (matched.size === 0) continue;

      hits.push({
        file,
        line: i + 1,
        matchedFields: Array.from(matched),
        preview: line.trim().slice(0, 120),
      });
      if (hits.length > 200) break;
    }
    if (hits.length > 200) break;
  }

  if (hits.length === 0) {
    return [{
      severity: "info",
      code: "LOG_PII_OK",
      message: `Scanned ${files.length} source file(s). No sensitive field names found inside log statements.`,
    }];
  }

  return hits.map((h) => ({
    severity: "warn" as const,
    code: "LOG_PII",
    message:
      `${h.file}:${h.line}: log statement references sensitive field(s) ${JSON.stringify(h.matchedFields)}. ` +
      `Preview: ${JSON.stringify(h.preview)}.`,
    fix:
      `Mask or omit the field. Example: 'log.info({ user_id })' instead of 'log.info({ user_id, email })'. ` +
      `If this log statement is genuinely safe (e.g. logging only the field name as a string, ` +
      `or a sanitised value), add a trailing comment '// agent-standards: allow-log-field <reason>'.`,
  }));
}
