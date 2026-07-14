# Production Readiness Checklist

> Walk this before a change ships to a real environment (staging or production).
> Org practice `production_readiness_gate` — **deploy-bound changes only**. Skip for
> refactors, tests, and docs. Advisory: surface gaps at review time, don't hard-block.
>
> A correct diff is not a deploy-ready one. Correctness says "it does what it should."
> Readiness says "we can run it, see it, and undo it." This checklist is the second question.

**Readiness = org rules (already enforced) + the deploy-specific concerns below.**
The standing security/quality baseline — OWASP Top 10 and ASVS L1 via `check_http_security`,
`check_secrets`, `check_client_bundle_secrets`, `check_cross_tenant_test`, and the
`auth_change_asvs_artifact` gate — is enforced by the standards on every change, and is a
**precondition** here, not something to re-review. Don't duplicate it. This checklist covers
what *deploying* adds on top: the security deltas that only appear at deploy time, plus
performance, observability, runbook, and rollback — none of which the org checks cover.

For each item: **pass / N-A / gap**. A gap isn't a veto — it's a thing to fix or to
consciously accept and note in the deploy message.

## Security — deploy-time deltas only

The OWASP/ASVS working set is owned by the standards (see above) — assume it's green before
you get here. This section is the security that's specific to *shipping to a real environment*:

- [ ] Production secrets are actually in the prod secret store — not just listed in `.env.example`, not still pointing at dev/staging values.
- [ ] Rate-limit / quota profiles are set for **production** traffic, not dev defaults.
- [ ] Nothing dev-permissive leaks to prod: debug routes, verbose error bodies, seed/test endpoints, wildcard CORS, disabled auth shortcuts.
- [ ] New external egress (a new API the service now calls in prod) is allowed by network policy and uses prod credentials.
- [ ] If the deploy includes a migration touching sensitive data, the data-at-rest expectations (encryption, retention) still hold after it runs.

## ISO 27001 — information security controls (deploy-time)

> Walk only when the change touches: authentication, authorisation, data storage/retention,
> user PII, audit trails, or access control logic. N-A for pure logic / UI / infra changes
> with no security surface.

- [ ] **Access control (A.9):** any new role, permission, or access path is documented and the principle of least privilege is preserved. No new "admin for now" shortcuts left in.
- [ ] **Data retention (A.8/A.11):** if the change stores new user data, the retention period is defined and the deletion path exists. No indefinite retention by omission.
- [ ] **Audit trail (A.12):** security-relevant actions (login, permission change, data export, admin action) produce a log entry that can't be silently dropped. New actions added by this change are included.
- [ ] **Cryptography (A.10):** any new data at rest or in transit uses the org-approved encryption standard. No custom crypto, no plaintext PII in logs or DB columns.
- [ ] **Incident response (A.16):** if this changes how auth, data access, or secrets work, the incident response runbook still accurately describes the blast radius and initial response steps. Update it if not.
- [ ] **Third-party / supply chain (A.15):** any new external dependency (API, SDK, package) has been assessed — data leaves the org boundary, what's shared, what's the vendor's retention policy?
- [ ] **Vulnerability management (A.12):** no known-vulnerable dependency version introduced. `check_secrets` and `check_http_security` passed (precondition — confirm before reaching here).

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
Readiness: security ok · iso27001: <ok | n-a | gaps: ...> · perf ok · observability ok · rollback: <how>
Gaps accepted: <none | list, with why>
Deployed to: <staging | prod>, verified at <endpoint>
```

If a section is N-A for this change, say so. Silent omission reads as "checked and passed" when it wasn't.
