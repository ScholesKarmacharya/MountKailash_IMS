# Responsive Admin navigation

The full sidebar no longer appears above mobile Admin content. The existing desktop sidebar remains visible at **1024px and above**. Below that breakpoint, a compact top navbar contains the menu button, Mount Kailash branding, EN/ने controls, notification bell and profile access. Main content starts directly beneath it with normal responsive padding.

The menu opens a native modal drawer aligned to the left, with a dark backdrop and a width capped at 384px (phone width minus 48px). Its navigation scrolls independently; the account/role and Sign Out section stays at the bottom. Close X, backdrop click, Escape, selecting any navigation link and resizing to desktop all close it. Keyboard focus stays inside, background content is inert, scrolling is locked while open, and scroll/focus return when it closes. No animation was introduced.

Desktop and drawer both render the same `Navigation` component and its existing 17-item configuration. The existing teal active-page style is retained; nested Admin detail routes also highlight their owning section. The Driver branch still uses the unchanged `DriverApplication`, and default Driver language/navigation behavior is retained.

## Changed files

- `src/components/admin-mobile-menu.tsx`: new client drawer, native modal behavior, focus containment, scroll restoration, route selection and breakpoint close handling.
- `src/components/app-shell.tsx`: responsive Admin sidebar/navbar; original Driver branch and offline cross-account banner behavior retained.
- `src/components/navigation.tsx`: optional route-selection callback and Admin child-route active matching; one navigation configuration reused.
- `src/components/localization.tsx`: optional compact language-control sizing; existing callers retain their defaults.
- `src/lib/i18n/en.json`, `ne.json`: menu action translations.
- `tests/operations-e2e/admin-navigation.spec.ts`: viewport/navigation/account regression checks.
- `tests/operations-e2e/fixture-client.ts`: mobile-aware menu helper for Sign Out in retained tests.
- `playwright.finance-local.config.ts`: the existing local viewport configuration now includes an iPhone-sized navigation project for repeatable checks.
- Retained mobile Sign Out selectors: `finance.spec.ts`, `daily-close.spec.ts`, `overnight-loading.spec.ts`, `admin-directory.spec.ts`, `driver-approval.spec.ts`, `driver-workflow.spec.ts`, `house.spec.ts`, `pending-jars.spec.ts` and `trip-cycle.spec.ts`.
- `tests/auth-e2e/auth.spec.ts`: expected Admin mobile navigation access updated. The live Auth suite was not executed in this task.

## Executed tests

**Six browser checks passed** at desktop 1280×720, breakpoint 1024×768, tablet 768×1024, Android-sized 412×839, iPhone-sized 390×844 and small mobile 360×800. Chromium uses real emulated viewport sizes; no physical-device or Safari result is claimed.

Checks cover sidebar/menu visibility, compact navbar height, content start position, all 17 items, teal active routes including details, independent drawer scrolling, Tab/Shift+Tab focus containment, inability to focus background main content, Escape/X/backdrop closing, selecting a navigation item closing the drawer, resize from 1023px to 1024px closing it, notification access, EN/ने switching, profile access, Sign Out and revoked session access. Approved Driver login and its existing New Sale navigation were also checked.

Two additional mobile regressions passed: the driver-directory account actions/login scenario and the complete physical trip cycle. The retained finance, Daily Close and overnight-loading scenarios also passed on both desktop and mobile. Build, TypeScript, changed-file lint, formatting and whitespace checks passed. The other adapted legacy Sign Out selectors were statically checked; their full scenarios were not rerun in this pass.

No routes, notifications, authentication actions, permissions, RLS or offline safety rules were changed. Scope and wider verification appear in [FINANCE_OPERATIONS_UI.md](./FINANCE_OPERATIONS_UI.md).

Visual evidence: [iPhone-sized drawer](../test-results/admin-drawer-iphone-sized.png), [360px Nepali navbar](../test-results/admin-navbar-small-mobile-ne.png).
