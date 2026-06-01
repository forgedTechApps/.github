# Mobile Guidelines

Mobile-specific guidance for the native + cross-platform apps (veda iOS/SwiftUI,
viyr/kurata/eleven11 Flutter). This is the **mobile companion** to
[`UI_UX_GUIDELINES.md`](UI_UX_GUIDELINES.md) — that doc holds the cross-cutting
UI contracts (async states, mutation→refresh, no-silent-actions, the
accessibility floor); this one holds what's genuinely mobile and what differs
by platform. Where they overlap, the UI/UX doc is the source of truth and is
linked, not restated.

Use it like the rest: each item is a **review question** for planning/PR time,
not a box to tick blindly. Two framing facts:

- **Points, not pixels.** Touch targets and type are specified in **pt (iOS) /
  dp (Android)**, never raw pixels — a "44px" target is ~⅓ size on a 3× screen.
- **Platform divergence is real.** iOS (Apple HIG) and Android (Material) differ
  on navigation, primary-action placement, and components. "Follow the native
  guideline" beats any single cross-platform rule below when they conflict.

---

## 1. Layout & touch ergonomics

- **Touch targets ≥ 44pt (iOS) / 48dp (Android)**, with spacing that prevents
  accidental adjacent taps. (Same floor as UI_UX_GUIDELINES §6 — stated in the
  correct unit here.)
- **Reachability:** primary actions sit in the thumb arc (lower-center on large
  phones), *but not at the cost of platform nav* — iOS confirm/nav actions are
  often top-right or in a bottom bar; don't move them just to be "low."
- **Safe areas are non-negotiable.** Respect safe-area insets / `SafeArea` —
  notch, Dynamic Island, status bar, home indicator, rounded corners. Content
  and tappables must never sit under them. (Top-3 real-world mobile layout bug;
  absent from generic checklists.)
- **Orientation & size classes:** decide per-screen; don't let a portrait-only
  layout break on landscape/iPad/foldables if those are supported.

## 2. Visual hierarchy & content

- **Mobile-first:** prioritise the core use-case on the smallest screen; defer
  the rest with **progressive disclosure** (menus/sheets), not clutter.
- **Outdoor legibility:** large type, high contrast (WCAG AA — UI_UX §6).
- **Dark mode** as a first-class theme, not an afterthought — and test that
  tokens (not hardcoded hex) drive both (UI_UX §7 / design_tokens check).

## 3. Navigation & controls (platform-split)

- **Use native core patterns:** iOS → tab bars, navigation stacks; avoid
  hamburger drawers (HIG discourages). Android → bottom nav + (optionally)
  nav drawer per Material. Don't ship an Android drawer on iOS as "familiar."
- **Gestures: standard only, and always with a visible backup.** Never hide a
  critical action behind a gesture alone. (Mirrors UI_UX §4 navigation rules.)
- **Lifecycle & interruption — beyond phone calls:** persist in-progress state
  across backgrounding, app-switcher, low-power mode, and process death.
  Restore correctly on cold start from a notification/deep link. **Redact
  sensitive content in the app-switcher snapshot** (see §6).

## 4. Forms & input

- **Contextual keyboards:** numeric/email/URL keyboard per field type.
- **Real-time inline validation** with recoverable errors (UI_UX §2/§3 — error
  states, never navigate away).
- **Frictionless auth:** biometric (Face/Touch ID, BiometricPrompt) + SSO where
  appropriate. For health-adjacent apps (veda/viyr), biometric gating of
  sensitive views is load-bearing, not optional.
- **Minimal typing:** prefill, autofill, device hardware (camera/scan), sensible
  defaults.

## 5. Performance & system feedback

- **Perceived speed:** skeleton screens during load (a *loading* state per
  UI_UX §2), not spinners-on-blank.
- **Asset weight:** compress images/video; mind slow/metered networks.
- **Offline-robust:** cache reads, queue writes, reconcile on reconnect, and
  show an honest offline state. (For data that's later mutated, honour the
  mutation→refresh contract in UI_UX §1.)
- **Instant feedback:** visual + **haptic** response to actions; never silent
  (UI_UX §3).

## 6. Permissions, privacy & sensitive data

- **Just-in-time prompts with a primer:** explain the benefit *before* the
  native permission dialog fires — only when the feature actually needs it.
- **Sensitive data (health-adjacent — veda, viyr):** never logged, never sent
  to analytics, encrypted at rest, excluded from crash dumps, and **redacted
  from the app-switcher snapshot** when backgrounded. (Mirrors the server-side
  rules in those repos' `.agent-standards.yml`; this is the on-device half.)
- **Actionable onboarding:** teach via interactive context, not walls of text.

## 7. Consistency & inclusion

- **Native alignment:** Apple HIG / Google Material — components, motion,
  system fonts, platform affordances.
- **Accessibility floor (UI_UX §6):** Dynamic Type / font scaling, screen reader
  labels (VoiceOver/TalkBack), contrast, focus order, reduced-motion respect.
- **Localization & RTL:** if shipping >1 locale, externalise strings and verify
  **RTL mirroring** of layouts (often missed until an Arabic/Hebrew user hits a
  reversed screen).

---

## How to use this

At planning/PR time for any screen, walk the relevant sections as questions:
"does this respect safe areas? is the target ≥44pt? what's the offline state?
is sensitive data redacted on backgrounding? does it match the platform's nav,
not a generic one?" The [interview-me](../skills/interview-me/SKILL.md) UI
branch and [`UI_UX_GUIDELINES.md`](UI_UX_GUIDELINES.md) cover the cross-cutting
contracts; this doc adds the mobile- and platform-specific layer.
