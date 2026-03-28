## What does this PR do?

<!-- One paragraph. What changed and why. Not how — the code shows how. -->

Closes #<!-- issue number -->

---

## Type of change

- [ ] New feature
- [ ] Bug fix
- [ ] Refactor (no behaviour change)
- [ ] Test improvement
- [ ] CI/CD / infrastructure
- [ ] Documentation
- [ ] Dependency update

---

## Implementation notes

<!-- Anything a reviewer needs to know that isn't obvious from the diff.
     Architecture decisions made, trade-offs accepted, known limitations. -->

---

## Testing

<!-- Describe what tests cover this change. Tick what applies. -->

- [ ] Unit tests added / updated
- [ ] Integration / widget tests added / updated
- [ ] UI / E2E tests added / updated
- [ ] Tested manually (describe how below if non-trivial)

**Manual testing notes:**
<!-- Delete if not applicable -->

---

## Quality checklist

Every item must be checked before requesting review.
A PR with unchecked items will not be merged.

### Code quality
- [ ] No compiler / analyser errors (typecheck, lint, SwiftLint, flutter analyze — whichever applies)
- [ ] No hardcoded values (strings, numbers, colours) — constants or config only
- [ ] No debug logging or temporary code left in
- [ ] No new external dependencies without justification in the PR description

### Tests
- [ ] All existing tests pass
- [ ] New behaviour is covered by tests
- [ ] Coverage thresholds maintained (unit ≥ 80%, integration ≥ 70%)
- [ ] Tests cover at least one error case, not only the happy path

### Security
- [ ] No secrets committed (API keys, passwords, tokens)
- [ ] User-supplied input is validated before use
- [ ] No new data stored without considering the deletion path

### Documentation
- [ ] `CLAUDE.md` updated if a new pattern, convention, or architectural decision was introduced
- [ ] Inline comments added for non-obvious logic
- [ ] Breaking changes documented in PR description

---

## Screenshots / recordings

<!-- Delete if not a UI change. For API-only changes, paste a sample request/response instead. -->

---

## Reviewer notes

<!-- Specific things you want the reviewer to focus on, or areas you're unsure about. -->
