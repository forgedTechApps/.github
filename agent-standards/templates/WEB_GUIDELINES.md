# Web Guidelines

Web-specific guidance for the web apps (kurata `apps/web` — Next.js; eleven11
web). The **web companion** to [`UI_UX_GUIDELINES.md`](UI_UX_GUIDELINES.md)
(cross-cutting UI contracts) and [`MOBILE_GUIDELINES.md`](MOBILE_GUIDELINES.md).
Where this overlaps the org's `.agent-standards.yml` invariants (secrets,
input validation, HTTP security) it links to the authoritative check rather
than restating — those are *enforced*, not just advised.

Each item is a **review question** at planning/PR time, not a blind checkbox.

---

## 1. Performance & Core Web Vitals

- **Assets:** modern formats (WebP/AVIF), minified CSS/JS/HTML, right-sized.
- **Lazy-load** off-screen images/video/components; prioritise above-the-fold.
- **Caching + CDN** for static assets; sensible cache headers.
- **No layout shift (CLS):** explicit width/height (or aspect-ratio) on media;
  reserve space for async content. (Ties to the loading-state contract in
  UI_UX §2.)
- **Framework-specific (the bigger lever for Next.js):** prefer **Server
  Components**; keep `'use client'` boundaries small; watch hydration cost and
  bundle size; stream/Suspense for slow data. For most pages this beats any
  single asset tweak above.

## 2. Architecture & code quality

- **Modular, single-purpose components** (mirrors the component-driven-design
  practice in org-defaults).
- **Semantic HTML:** `<main>`, `<nav>`, `<article>`, `<button>` over nested
  `<div>`s — it's the foundation accessibility (§5) builds on.
- **Dependency safety:** the real protection against breaking updates is a
  **committed lockfile + ranged/pinned deps + the CI dependency-audit**, not
  SemVer alone (SemVer is the publisher's promise, not your guarantee).
- **Testing matches the spec:** unit for logic, integration for key flows, E2E
  for critical journeys — order per the org `test_order_by_spec` practice.

## 3. Responsive & adaptive layout

- **Mobile-first CSS**, Grid/Flexbox, fluid by default.
- **Relative units** (rem/em/vw/vh, `clamp()` for fluid type) over fixed px.
- **Breakpoints at content** break-points, not device widths.
- **SVG** for icons/illustrations (crisp on any density).
- **Design tokens, not magic values** — enforced by `check_design_consistency`
  (org-defaults `design_tokens_only`).

## 4. Security & data protection

- **HTTPS everywhere**; HSTS. (Org `http_security_headers` hint.)
- **CSP headers** to mitigate XSS/injection; also X-Content-Type-Options,
  X-Frame-Options/frame-ancestors, Referrer-Policy. (`check_http_security`.)
- **Validation is server-authoritative.** Validate/sanitise at every server
  boundary (org `input_validation_at_boundary`; kurata validates with Zod from
  `@kurata/shared`). Client-side validation is **UX only — it's bypassable**,
  never the security boundary.
- **No secrets in the client bundle.** Service-role / admin keys must never
  reach the browser — enforced by **`check_client_bundle_secrets`** (runs on
  the *built* output). The single most important web-security item for the
  Supabase/Next stack.
- **Auth — match the actual stack.** kurata uses **Lucia + passkeys (WebAuthn) +
  magic-link**, not passwords; HTTP-only, Secure, SameSite session cookies.
  *If* a repo does store passwords, strong hashing (argon2/bcrypt) — but prefer
  the passwordless path the org already uses. CORS allowlist explicit per-origin
  (`cors_explicit_origins`, error-level).

## 5. Accessibility (a11y) & SEO

- **Keyboard:** fully operable via Tab/Enter/Esc with **visible focus states**;
  logical focus order; no keyboard traps. (Extends UI_UX §6.)
- **ARIA only where native won't do** — prefer semantic elements; add ARIA to
  custom/dynamic widgets, and keep it correct (a wrong role is worse than none).
- **Contrast ≥ 4.5:1** body text (WCAG AA — UI_UX §6); respect prefers-reduced-
  motion and dynamic text scaling.
- **SEO/metadata:** unique `<title>` + meta description per page, canonical URLs,
  Open Graph/structured data where it matters. (Next.js: the Metadata API.)

## 6. State management & data fetching

- **Optimistic UI** for cheap mutations (like/toggle), revert on failure — but
  honour the **mutation→refresh contract** (UI_UX §1): every view showing the
  data must reflect the write (invalidate/revalidate), including server caches.
- **Graceful errors:** error boundaries + friendly fallback pages; never a
  silent crash or a blank screen (UI_UX §2 error state, §3 no-silent-actions).
- **Efficient fetching:** a caching/query layer (e.g. React Query / RSC fetch
  cache) to dedupe requests across components; don't N+1 the API from sibling
  components.

---

## How to use this

At planning/PR time for web work, walk the relevant sections as questions:
"are secrets out of the client bundle? is validation server-authoritative? what
holds CLS? is it keyboard-operable with visible focus? does the mutation
refresh every view?" The [interview-me](../skills/interview-me/SKILL.md) UI
branch routes here; the enforced items (secrets, input validation, HTTP
security, design tokens) are checks in `.agent-standards.yml`, not just advice.
