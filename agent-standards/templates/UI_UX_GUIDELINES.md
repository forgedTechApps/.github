# UI/UX Guidelines

> Durable guidance for building UI in forgedTechApps projects. **Judgment, not enforcement** —
> like `PRINCIPLES.md`, this informs decisions; it is not a checklist of mechanically-checked rules.
> Read it when doing UI/UX work. Project-specific design systems (eleven11's palettes, Veda's
> Domain purity, etc.) live in each project's CLAUDE.md and override or extend what's here.
>
> These are distilled from real lessons across the suite (TanStack Query, Riverpod, SwiftData,
> Supabase Realtime). Where a rule cites a stack, it's an example — apply the principle to yours.

---

## 1. The mutation → UI contract (refresh after CRUD)

The most common UI bug: a create/update/delete succeeds on the server, but the screen still shows
stale data because nothing told the UI to re-fetch. **Every mutation has a UI contract — answer all
of it before writing the mutation:**

1. **Which views show this data?** List them. A mutation often affects more than the screen you're
   on — a list AND a detail view, a badge count, a dashboard card, another tab.
2. **How does each refresh?** Name the mechanism:
   - **TanStack Query** → `queryClient.invalidateQueries({ queryKey })` in the mutation's `onSuccess`;
     Next.js server actions → `revalidatePath(...)` / `revalidateTag(...)`.
   - **Riverpod** → `ref.invalidate(theProvider)` after the write (or an `AsyncNotifier` that
     re-reads). Invalidate **every** provider that derives from the mutated data, not just the one
     you're looking at.
   - **SwiftData** → `@Query` views auto-refresh when the context saves; the contract is "did the
     write go through the same `ModelContext`?" If you mutate off-context, the view won't update.
3. **Optimistic or pessimistic?** Does the UI update immediately (optimistic, with rollback on
   error) or wait for the server (pessimistic, with a spinner)? Pick deliberately — optimistic for
   high-frequency low-risk actions (checking a shopping item), pessimistic for consequential ones
   (deleting an account). If optimistic, **the rollback path is part of the feature**, not an extra.
4. **Cross-surface + realtime consistency.** If the same data is live on multiple devices/screens
   (e.g. a collaborative list), invalidation alone isn't enough — the realtime subscription must
   carry the change, and the local optimistic update must reconcile with the echoed server event
   (last-write-wins, merge, etc.). Decide the reconciliation rule.

**Smell:** a mutation function with no `invalidate` / `revalidate` / context-save in sight, and no
comment saying why. That's almost always a stale-screen bug waiting to happen.

**Cache is not just the query layer.** Server-side caches count too: if a write invalidates a UI
query but not the Redis/context cache feeding it, the UI re-fetches stale data. "Write-invalidated"
must hold at every cache layer between the write and the pixel.

**Never read mutable state from a stale source.** A real bug this caused: reading a subscription
tier from a DB column that lags the source of truth, instead of the live entitlement provider.
After a mutation, read from the thing that just changed — not a cached projection of it.

---

## 2. Every async surface has three states (+ empty)

Loading, error, and data are not optional branches — handle all three, every time. Plus empty as a
distinct, designed state (not a blank data state).

- **Loading** — show progress in place. Don't block the whole screen if only part is loading; don't
  show a dead frame.
- **Error** — a message the user understands ("Couldn't load your data") **+ a way to recover**
  (Retry that re-invalidates). **Errors never navigate the user away** — recover in place.
- **Empty** — a designed state with a glyph + explanation + a next action (the CTA), distinct from
  loading and distinct from error. "No items yet" is a different screen than "failed to load."
- **Partial / stale-while-revalidating** — if you show cached data while re-fetching, indicate it's
  refreshing rather than implying it's fresh.

Centralise this. A single async-state wrapper (eleven11's `asyncValue.when(...)` pattern) used
everywhere beats per-screen ad-hoc handling — it makes the three states impossible to forget.

---

## 3. Feedback: never act silently

Every user action gets acknowledgement proportional to its weight:

- **Immediate** — a tap shows pressed state instantly; a submit disables the button + shows progress.
- **Result** — success and failure are both visible. Silent success ("did it work?") erodes trust
  as much as a silent failure.
- **Destructive / irreversible** — confirm first, or provide undo. A 30-second undo on a silent
  action (Kurata's voice confirmation card) is often better UX than a blocking confirm dialog.
- **Long operations** — show it's alive (progress label, not just a spinner) and keep the screen
  awake if the OS would sleep mid-operation.

---

## 4. Navigation

Org-wide, navigation **structure** is project-specific — each project's CLAUDE.md owns its router
rules (e.g. "GoRouter only, no `Navigator.push` in feature code", "`go` for tabs / `push` for
detail"). The cross-project *principles*:

- **One router, centralised.** Navigation decisions live in one place, not scattered as imperative
  pushes inside widgets/components.
- **Tab vs. detail semantics are explicit and consistent.** Switching tabs replaces the stack;
  opening a detail adds to it. Don't mix the two metaphors.
- **Back is predictable.** A detail screen has a back affordance; a tab root does not. Errors and
  empty states recover in place — they don't yank the user to another screen.
- **Deep links and state restoration** should land the user in a coherent place, not a half-built
  screen.

---

## 5. Perceived performance

The app should *feel* fast even when it isn't:

- **Optimistic updates** for frequent actions (see §1) — the UI responds before the round-trip.
- **Skeletons over spinners** for content that has a known shape — they imply structure and reduce
  perceived wait.
- **Don't re-fetch what you have.** Stale-while-revalidate: show cached data instantly, refresh in
  the background, swap when ready.
- **Animate state changes** rather than hard-cutting — content that drifts/fades in reads as alive;
  instant pops read as janky. (But respect reduced-motion.)

---

## 6. Accessibility & inclusivity (the floor, not a feature)

- **Contrast** meets WCAG AA. **Touch targets** ≥ 44pt. **Dynamic Type / font scaling** respected.
- **Semantic labels** on interactive elements and images that carry meaning.
- **Reduced-motion** honored — animations are enhancement, never required to use the app.
- **Don't encode meaning in colour alone** — pair it with text/shape (a red dot AND a label).

---

## 7. Consistency

- **Design tokens, not magic values.** Colours, spacing, type, radii, durations come from the named
  system — never hardcoded inline. (This one IS mechanically checked in most projects:
  `design_tokens_only`.)
- **One component library** for cross-feature primitives (Button, Card, Modal). Features consume it;
  they don't re-implement it.
- **Same interaction, same result, everywhere.** Pull-to-refresh, swipe-to-delete, the loading
  spinner — pick one implementation and use it consistently across screens.

---

## How to use this

- **Planning UI work:** the interview-me interview's UI branch walks the high-risk items here (the
  mutation→UI contract especially). Answer them before writing code.
- **Reviewing UI work:** these are the questions a stranger reviewer asks of a UI diff — "what does
  this show while loading / on error / when empty? what refreshes after this mutation?"
- **Project specifics win.** Where a project's CLAUDE.md or design system says something more
  specific, follow that. This file is the shared floor and the tie-breaker when the project is silent.
