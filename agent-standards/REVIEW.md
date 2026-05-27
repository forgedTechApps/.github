# Quarterly Standards Review

Per `IMPLEMENTATION_PLAN.md` Increment 11: the framework grows by evidence,
not by accretion. The drift log captures what rules actually fire; this
review uses that data to promote, demote, or delete rules.

**Cadence:** every 90 days. Tie it to an existing rhythm (security review,
quarterly planning) so it doesn't get skipped.

**Automation:** copy
[`agent-standards/workflows/quarterly-review.yml.template`](workflows/quarterly-review.yml.template)
into each project's `.github/workflows/agent-standards-quarterly-review.yml`.
The action runs on a quarterly cron (1st of Mar/Jun/Sep/Dec) and opens an
issue with the report. The issue is the agenda — skipping the meeting
doesn't skip the artifact.

**Authority:** the user (Carlos) decides. The agent surfaces data and
proposes actions; nothing auto-promotes or auto-demotes.

---

## Inputs

For each project that uses agent-standards:

```text
get_rule_metrics --window_days 90
```

Returns three lists:

1. **`rules_with_events`** — rules that fired at least once. Sorted by
   count, most-fired first.
2. **`rules_with_zero_events`** — rules declared in `.agent-standards.yml`
   (or inherited from org-defaults) that didn't fire. Candidates for
   demotion or deletion.
3. **`unmapped_codes`** — drift-log codes that aren't mapped to any rule
   ID. Each represents either a check that needs its code mapped in
   `rule-metrics.ts`, or a rule that should be added.

---

## Decisions per rule

For each rule with events:

| Pattern | Likely action |
|---|---|
| **High count, all severity: warn** | Promote to `severity: error` after cleanup. The rule is catching real things and projects have had time to fix. |
| **High count, all severity: error** | Investigate. Either the rule is too strict, the codebase has a systemic issue, or the rule should escalate to a Gate (tooling investment justified). |
| **High count, mostly info** | Likely benign — info findings are status, not violations. Check that the code→rule_id mapping is right. |
| **Low count, recent latest** | Healthy. The rule fires occasionally and is caught. No action. |
| **Low count, stale latest (>60d)** | One-off pattern. Consider whether the rule is still load-bearing. |

For each rule with zero events:

| Tier | Likely action |
|---|---|
| **Invariant** | Either the check has a bug (false negative) or the rule no longer applies. Spot-check by intentionally violating in a test branch — if the check still doesn't fire, fix or delete. |
| **Gate** | Gate exists but doesn't block anything in practice. Either the workflow it gates is genuinely uncommon (keep but accept low value), or the gate isn't wired correctly. |
| **Practice** | Aspirational rules that never get cited. Demote to `CLAUDE.md` Principles section — they're cultural, not enforceable. |

For each unmapped code:

- Add to `CODE_TO_RULE_ID` in `mcp-server/src/rule-metrics.ts` if it
  corresponds to an existing rule.
- If it's a new pattern that doesn't have a rule, **don't add a rule just
  because a code exists**. Ask: should this be a tracked rule? If yes,
  add the rule first.

---

## Output: decision log

Append decisions to `.agent-standards-decisions.md` per project (or
org-wide in `forgedtech/agent-standards/DECISIONS.md` for org-defaults
changes):

```markdown
## 2026-Q3 review (2026-08-31)

- `no_pii_in_logs` (warn, 47 events in Q3): cleanup pass complete on
  Viyr, Kurata, eleven11v2. **Promoting to error** in org-defaults.
- `view_size_limit` (zero events, invariant, deferred): check still not
  built after two quarters. **Demoting to Practice** until a project
  asks for it.
- `cors_explicit_origins` (zero events, invariant, deferred Beyond W15):
  no project currently has HTTP services that handle credentials.
  **Keeping deferred**, re-evaluate next quarter.

## 2026-Q2 review (2026-05-31)

(initial review — see IMPLEMENTATION_PLAN W15+ commitment)
```

This decision log is the audit trail. Every promotion/demotion has a
reason captured at the time it happened.

---

## What NOT to do

- **Don't promote a Practice to a Gate without tooling.** Promotion
  requires either an existing MCP tool or a commitment to build one in the
  next increment.
- **Don't delete a rule that hasn't fired *because* the code path it
  guards rarely runs.** Auth-change rules might fire ~2× per year and
  still be load-bearing.
- **Don't auto-run promotions from the metrics output.** The framework
  changes by decision, not by threshold.
- **Don't skip the review because you're busy.** A review that gets
  skipped becomes decoration. If you genuinely can't do it quarterly,
  drop to twice-a-year — cadence you maintain beats cadence you aspire to.

---

## Next review

Set a calendar reminder for 90 days after the last review. The first one
is scheduled for **2026-08-31** per IMPLEMENTATION_PLAN.md Increment 12.
