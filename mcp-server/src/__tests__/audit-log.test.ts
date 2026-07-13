import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAuditEvent, readAuditLog, auditSummaryLine } from "../audit-log.js";

async function tmpRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "audit-log-test-"));
}

test("appendAuditEvent writes a JSONL line", async () => {
  const repo = await tmpRepo();
  await appendAuditEvent(repo, {
    ts: "2026-07-13T00:00:00.000Z",
    kind: "task_started",
    task_id: "abc123",
    detail: { phase: "execution" },
  });

  const raw = await readFile(join(repo, ".agent-standards-audit.jsonl"), "utf8");
  const lines = raw.trim().split("\n").filter((l): l is string => l.length > 0);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.kind, "task_started");
  assert.equal(parsed.task_id, "abc123");
});

test("appendAuditEvent appends multiple events", async () => {
  const repo = await tmpRepo();
  await appendAuditEvent(repo, { ts: "2026-07-13T00:00:00.000Z", kind: "task_started", task_id: "a", detail: {} });
  await appendAuditEvent(repo, { ts: "2026-07-13T00:00:01.000Z", kind: "propose_change", task_id: "a", detail: { outcome: "allowed" } });

  const result = await readAuditLog(repo);
  assert.equal(result.total, 2);
  assert.equal(result.by_kind["task_started"] ?? 0, 1);
  assert.equal(result.by_kind["propose_change"] ?? 0, 1);
});

test("readAuditLog returns empty summary when file absent", async () => {
  const repo = await tmpRepo();
  const result = await readAuditLog(repo);
  assert.equal(result.total, 0);
  assert.deepEqual(result.events, []);
});

test("readAuditLog respects limit", async () => {
  const repo = await tmpRepo();
  for (let i = 0; i < 5; i++) {
    await appendAuditEvent(repo, { ts: `2026-07-13T00:00:0${i}.000Z`, kind: "propose_change", task_id: "t", detail: { i } });
  }
  const result = await readAuditLog(repo, 3);
  assert.equal(result.total, 5);
  assert.equal(result.events.length, 3);
});

test("readAuditLog counts by_kind correctly", async () => {
  const repo = await tmpRepo();
  await appendAuditEvent(repo, { ts: "2026-07-13T00:00:00.000Z", kind: "task_started", task_id: "t", detail: {} });
  await appendAuditEvent(repo, { ts: "2026-07-13T00:00:01.000Z", kind: "trivial_bypass", task_id: "t", detail: {} });
  await appendAuditEvent(repo, { ts: "2026-07-13T00:00:02.000Z", kind: "trivial_bypass", task_id: "t", detail: {} });
  await appendAuditEvent(repo, { ts: "2026-07-13T00:00:03.000Z", kind: "gate_fired", task_id: "t", detail: {} });

  const result = await readAuditLog(repo);
  assert.equal(result.by_kind["task_started"] ?? 0, 1);
  assert.equal(result.by_kind["trivial_bypass"] ?? 0, 2);
  assert.equal(result.by_kind["gate_fired"] ?? 0, 1);
});

test("auditSummaryLine formats correctly", async () => {
  const repo = await tmpRepo();
  await appendAuditEvent(repo, { ts: "2026-07-13T00:00:00.000Z", kind: "task_started", task_id: "t", detail: {} });
  await appendAuditEvent(repo, { ts: "2026-07-13T00:00:01.000Z", kind: "propose_change", task_id: "t", detail: {} });

  const summary = await readAuditLog(repo);
  const line = auditSummaryLine(summary);
  assert.ok(line.startsWith("Audit log: 2 events"), `Expected prefix, got: ${line}`);
  assert.ok(line.includes("task_started"));
  assert.ok(line.includes("propose_change"));
});

test("auditSummaryLine handles empty log", async () => {
  const repo = await tmpRepo();
  const summary = await readAuditLog(repo);
  assert.equal(auditSummaryLine(summary), "Audit log: no events recorded.");
});

test("appendAuditEvent does not throw on bad repo path", async () => {
  await assert.doesNotReject(
    appendAuditEvent("/nonexistent/path/that/should/not/exist", {
      ts: "2026-07-13T00:00:00.000Z",
      kind: "task_started",
      task_id: "x",
      detail: {},
    })
  );
});
