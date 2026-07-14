import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkModelAlignment } from "../standards.js";
import { startTask } from "../task-tracking.js";
import type { AgentStandards, ModelSpec } from "../standards.js";

async function tmpRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "model-alignment-test-"));
}

const fableSpec: ModelSpec = { model: "fable", effort: "medium", fallback: ["opus", "sonnet"] };
const opusSpec: ModelSpec = { model: "opus", effort: "medium", fallback: ["sonnet"] };
const sonnetSpec: ModelSpec = { model: "sonnet", fallback: ["opus"] };

// ── checkModelAlignment unit tests ──────────────────────────────────────────

test("primary match returns ok=true, isFallback=false", () => {
  const result = checkModelAlignment("fable", fableSpec);
  assert.equal(result.ok, true);
  assert.equal(result.isFallback, false);
  assert.equal(result.message, undefined);
});

test("first fallback match returns ok=true, isFallback=true with message", () => {
  const result = checkModelAlignment("opus", fableSpec);
  assert.equal(result.ok, true);
  assert.equal(result.isFallback, true);
  assert.ok(result.message?.includes("opus"));
  assert.ok(result.message?.includes("fable"));
});

test("second fallback match returns ok=true, isFallback=true", () => {
  const result = checkModelAlignment("sonnet", fableSpec);
  assert.equal(result.ok, true);
  assert.equal(result.isFallback, true);
  assert.ok(result.message?.includes("sonnet"));
});

test("out-of-set declared returns ok=false", () => {
  const result = checkModelAlignment("haiku", fableSpec);
  assert.equal(result.ok, false);
  assert.equal(result.isFallback, false);
  assert.ok(result.message?.includes("haiku"));
  assert.ok(result.message?.includes("fable"));
});

test("null declared returns ok=true, isFallback=false (advisory)", () => {
  const result = checkModelAlignment(null, fableSpec);
  assert.equal(result.ok, true);
  assert.equal(result.isFallback, false);
});

test("sonnet blocked when only primary (no fallback) and declared is haiku", () => {
  const spec: ModelSpec = { model: "sonnet" };
  const result = checkModelAlignment("haiku", spec);
  assert.equal(result.ok, false);
});

// ── start_task integration: refactor phase ───────────────────────────────────

const refactorStandards: AgentStandards = {
  version: 1,
  repo: "test/repo",
  models: {
    refactor: { model: "fable", effort: "medium", fallback: ["opus", "sonnet"] },
  },
} as AgentStandards;

test("refactor phase with fable model is allowed, no fallback tip", async () => {
  const repo = await tmpRepo();
  const result = await startTask(repo, {
    description: "complex refactor",
    hypothesis: "restructure module boundaries",
    phase: "refactor",
    current_model: "claude-fable-5",
  }, refactorStandards);
  assert.equal(result.blocked, false);
  assert.ok(!result.message.includes("WRONG MODEL"));
  assert.ok(!result.message.includes("fallback"));
});

test("refactor phase with opus model is allowed with fallback tip", async () => {
  const repo = await tmpRepo();
  const result = await startTask(repo, {
    description: "complex refactor",
    hypothesis: "restructure module boundaries",
    phase: "refactor",
    current_model: "claude-opus-4-8",
  }, refactorStandards);
  assert.equal(result.blocked, false);
  assert.ok(result.message.includes("fallback"));
  assert.ok(result.message.includes("opus"));
});

test("refactor phase with haiku model is blocked (not in fallback chain)", async () => {
  const repo = await tmpRepo();
  const result = await startTask(repo, {
    description: "complex refactor",
    hypothesis: "restructure module boundaries",
    phase: "refactor",
    current_model: "claude-haiku-4-5-20251001",
  }, refactorStandards);
  assert.equal(result.blocked, true);
  assert.ok(result.message.includes("WRONG MODEL"));
});

// ── start_task integration: analysis phase ───────────────────────────────────

const analysisStandards: AgentStandards = {
  version: 1,
  repo: "test/repo",
  models: {
    analysis: { model: "fable", effort: "medium", fallback: ["opus", "sonnet"] },
  },
} as AgentStandards;

test("analysis phase with fable model is allowed", async () => {
  const repo = await tmpRepo();
  const result = await startTask(repo, {
    description: "stranger review",
    hypothesis: "diff has edge cases",
    phase: "analysis",
    current_model: "claude-fable-5",
  }, analysisStandards);
  assert.equal(result.blocked, false);
  assert.ok(!result.message.includes("WRONG MODEL"));
});

test("analysis phase with opus model is allowed with fallback tip", async () => {
  const repo = await tmpRepo();
  const result = await startTask(repo, {
    description: "stranger review",
    hypothesis: "diff has edge cases",
    phase: "analysis",
    current_model: "claude-opus-4-8",
  }, analysisStandards);
  assert.equal(result.blocked, false);
  assert.ok(result.message.includes("fallback"));
});
