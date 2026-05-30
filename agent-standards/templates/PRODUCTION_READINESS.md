# Production Readiness Checklist

> Walk this before a change ships to a real environment (staging or production).
> Org practice `production_readiness_gate` — **deploy-bound changes only**. Skip for
> refactors, tests, and docs. Advisory: surface gaps at review time, don't hard-block.
>
> A correct diff is not a deploy-ready one. Correctness says "it does what it should."
> Readiness says "we can run it, see it, and undo it." This checklist is the second question.

For each item: **pass / N-A / gap**. A gap isn't a veto — it's a thing to fix or to
consciously accept and note in the deploy message.

## Security

- [ ] No secret, token, or key added to client bundles or committed files (env / secret store only).
- [ ] New endpoints/queries enforce authn + authz at the boundary (not just client-side gating).
- [ ] Tenant/owner scoping holds for any new data path (the real defense is the cross-tenant test, not a signature check).
- [ ] Input validated at the boundary; new external calls bound by timeout + size limits.
- [ ] No PII / health / credential data added to logs, analytics, crash reports, or AI prompts.
- [ ] If auth/data/template surface touched: ASVS L1 mental review done (A01–A10).

## Performance

- [ ] Failure mode under load is understood: what happens at 10×, 100× the expected rate?
- [ ] New DB queries are indexed for their access pattern (checked, not assumed).
- [ ] No unbounded fan-out, N+1, or unpaginated list that grows with data.
- [ ] Expensive work (AI calls, heavy compute) is cached / rate-limited / debounced where appropriate.
- [ ] New external dependency has a timeout and a defined behaviour on slow/failed response.

## Observability

- [ ] New code paths emit a log line at the right level (not noise, not silence).
- [ ] Success AND failure of the new path are both observable (metric, log, or trace).
- [ ] An on-call engineer could tell from telemetry alone whether this feature is working.
- [ ] Errors carry enough context to diagnose without reproducing (ids, not raw payloads).
- [ ] If a new background job / worker / cron: its runs and failures are visible.

## Runbook (how is this operated?)

- [ ] If this introduces a new operational surface (worker, queue, scheduled task, feature flag), how it's started, stopped, and inspected is written down.
- [ ] Known failure modes have a documented response ("if X alert fires, do Y").
- [ ] Any manual step required for deploy (migration, secret, config, flag flip) is listed in order.
- [ ] On-call knows where to look — pointer to dashboard / logs / the relevant doc.

## Rollback

- [ ] There is a way to undo this change, and it's stated explicitly.
- [ ] The change is backward-compatible enough to roll back safely — old code can run against the new state (and vice versa) for the rollback window.
- [ ] DB migrations are forward-only AND reversible, or the irreversibility is called out and approved.
- [ ] If shipped behind a flag: the flag's off-state is the safe state and is tested.
- [ ] Rolling back doesn't strand data written by the new code in an unreadable shape.

---

## Deploy message

When reporting a deploy, state the readiness posture, not just "deployed":

```
Readiness: security ok · perf ok · observability ok · rollback: <how>
Gaps accepted: <none | list, with why>
Deployed to: <staging | prod>, verified at <endpoint>
```

If a section is N-A for this change, say so. Silent omission reads as "checked and passed" when it wasn't.
