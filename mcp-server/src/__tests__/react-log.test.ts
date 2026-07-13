import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendReactEntry, readReactLog } from "../react-log.js";
import { proposeChange } from "../task-tracking.js";
import { startTask } from "../task-tracking.js";
import type { AgentStandards } from "../standards.js";

async function tmpRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "react-log-test-"));
}

const minimalStandards: AgentStandards = {
  version: 1,
  repo: "test/repo",
} as AgentStandards;

test("appendReactEntry writes JSONL with all fields", async () => {
  const repo = await tmpRepo();
  await appendReactEntry(repo, {
    ts: "2026-07-13T00:00:00.000Z",
    kind: "propose_change",
    task_id: "abc123",
    thought: "this is the right file because it is the only place X is called",
    action: { description: "add call site", paths: ["src/foo.ts"] },
    observation: { outcome: "allowed", codes: ["TASK_PROPOSE_OK"], summary: "OK" },
  });

  const result = await readReactLog(repo);
  assert.equal(result.total, 1);
  assert.equal(result.entries[0]!.thought, "this is the right file because it is the only place X is called");
  assert.equal(result.entries[0]!.kind, "propose_change");
});

test("thought_coverage is 100% when all entries have thought", async () => {
  const repo = await tmpRepo();
  await appendReactEntry(repo, { ts: "2026-07-13T00:00:00.000Z", kind: "start_task", task_id: "t", thought: "reason A", action: { description: "d" }, observation: { outcome: "allowed", codes: [], summary: "" } });
  await appendReactEntry(repo, { ts: "2026-07-13T00:00:01.000Z", kind: "propose_change", task_id: "t", thought: "reason B", action: { description: "d" }, observation: { outcome: "allowed", codes: [], summary: "" } });

  const result = await readReactLog(repo);
  assert.equal(result.thought_coverage, 100);
});

test("thought_coverage is 0% when no entries have thought", async () => {
  const repo = await tmpRepo();
  await appendReactEntry(repo, { ts: "2026-07-13T00:00:00.000Z", kind: "start_task", task_id: "t", action: { description: "d" }, observation: { outcome: "warned", codes: ["REACT_NO_THOUGHT"], summary: "" } });

  const result = await readReactLog(repo);
  assert.equal(result.thought_coverage, 0);
});

test("thought_coverage is partial when some entries have thought", async () => {
  const repo = await tmpRepo();
  await appendReactEntry(repo, { ts: "2026-07-13T00:00:00.000Z", kind: "start_task", task_id: "t", thought: "reason", action: { description: "d" }, observation: { outcome: "allowed", codes: [], summary: "" } });
  await appendReactEntry(repo, { ts: "2026-07-13T00:00:01.000Z", kind: "propose_change", task_id: "t", action: { description: "d" }, observation: { outcome: "warned", codes: ["REACT_NO_THOUGHT"], summary: "" } });
  await appendReactEntry(repo, { ts: "2026-07-13T00:00:02.000Z", kind: "expand_scope", task_id: "t", action: { description: "d" }, observation: { outcome: "warned", codes: ["REACT_NO_THOUGHT"], summary: "" } });

  const result = await readReactLog(repo);
  assert.equal(result.thought_coverage, 33);
});

test("readReactLog filters by task_id", async () => {
  const repo = await tmpRepo();
  await appendReactEntry(repo, { ts: "2026-07-13T00:00:00.000Z", kind: "start_task", task_id: "task-A", thought: "r", action: { description: "d" }, observation: { outcome: "allowed", codes: [], summary: "" } });
  await appendReactEntry(repo, { ts: "2026-07-13T00:00:01.000Z", kind: "propose_change", task_id: "task-B", thought: "r", action: { description: "d" }, observation: { outcome: "allowed", codes: [], summary: "" } });

  const result = await readReactLog(repo, 50, "task-A");
  assert.equal(result.total, 1);
  assert.equal(result.entries[0]!.task_id, "task-A");
});

test("readReactLog respects limit", async () => {
  const repo = await tmpRepo();
  for (let i = 0; i < 5; i++) {
    await appendReactEntry(repo, { ts: `2026-07-13T00:00:0${i}.000Z`, kind: "propose_change", task_id: "t", thought: "r", action: { description: "d" }, observation: { outcome: "allowed", codes: [], summary: "" } });
  }
  const result = await readReactLog(repo, 3);
  assert.equal(result.total, 5);
  assert.equal(result.entries.length, 3);
});

test("readReactLog returns empty when file absent", async () => {
  const repo = await tmpRepo();
  const result = await readReactLog(repo);
  assert.equal(result.total, 0);
  assert.equal(result.thought_coverage, 0);
  assert.deepEqual(result.entries, []);
});

test("appendReactEntry does not throw on bad repo path", async () => {
  await assert.doesNotReject(
    appendReactEntry("/nonexistent/path/that/should/not/exist", {
      ts: "2026-07-13T00:00:00.000Z",
      kind: "start_task",
      task_id: "x",
      action: { description: "d" },
      observation: { outcome: "allowed", codes: [], summary: "" },
    })
  );
});

test("propose_change without thought emits REACT_NO_THOUGHT warning", async () => {
  const repo = await tmpRepo();
  // Start a task first
  await startTask(repo, {
    description: "test task for react warn",
    hypothesis: "testing REACT_NO_THOUGHT",
    phase: "execution",
    expected_writes: ["src/foo.ts"],
  }, minimalStandards);

  const findings = await proposeChange(repo, {
    paths: ["src/foo.ts"],
    rationale: "test write without thought",
    // no thought field
  }, minimalStandards);

  const warnCodes = findings.map((f) => f.code);
  assert.ok(warnCodes.includes("REACT_NO_THOUGHT"), `Expected REACT_NO_THOUGHT in ${JSON.stringify(warnCodes)}`);
  const warn = findings.find((f) => f.code === "REACT_NO_THOUGHT");
  assert.equal(warn?.severity, "warn");
});

test("propose_change with thought does not emit REACT_NO_THOUGHT", async () => {
  const repo = await tmpRepo();
  await startTask(repo, {
    description: "test task for react no-warn",
    hypothesis: "testing thought present",
    phase: "execution",
    expected_writes: ["src/bar.ts"],
  }, minimalStandards);

  const findings = await proposeChange(repo, {
    paths: ["src/bar.ts"],
    rationale: "test write with thought",
    thought: "src/bar.ts is the only file that handles this concern",
  }, minimalStandards);

  const warnCodes = findings.map((f) => f.code);
  assert.ok(!warnCodes.includes("REACT_NO_THOUGHT"), `Did not expect REACT_NO_THOUGHT in ${JSON.stringify(warnCodes)}`);
});
