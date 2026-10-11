# Supabase Cloud: Sprint 0 account setup

Use the linked Cloud project. No Docker or database reset is involved.

## Verified setup

- `.env.local` has the Cloud API URL and public key, matching the linked project reference. The app uses these two variables only.
- Migration `202610110001` is recorded in both local and remote migration history. `profiles` and `business_days` exist in Cloud. Do not apply the SQL file again.
- DEMO admin and driver accounts were created with confirmed emails and explicit active profiles. Unique generated passwords are stored only in ignored `.env.local`, under `DEMO_ADMIN_PASSWORD` and `DEMO_DRIVER_PASSWORD`.
- The service-role key is not stored in `.env.local` and is not needed by the app. The provisioning helper obtained admin access from the authenticated Supabase CLI, kept it in memory, and suppressed its output.
- Cloud email/password is enabled and email confirmation is required. Cloud public signup is currently **enabled**; disable “Allow new users to sign up” in the Cloud Auth settings to match the private, admin-provisioned account model. `supabase/config.toml` configures local development and does not automatically update Cloud Auth settings. See [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration).
- Both accounts passed real browser login on desktop and mobile: correct role dashboards, responsive navigation, driver exclusion from admin and sign-out. The existing development server was reused at http://localhost:3000.

The `.example` emails are non-deliverable demo identities, auto-confirmed using the trusted Admin API. Do not use them for real staff or email password recovery. Real staff accounts should use deliverable emails and the normal invitation/confirmation process.

## Safe migration commands

```powershell
npx.cmd --no-install supabase migration list --linked
npx.cmd --no-install supabase db push --linked --dry-run
```

Only if migration history and the dry run show the reviewed Sprint 0 migration as pending, apply it using:

```powershell
npx.cmd --no-install supabase db push --linked
```

This pushes all pending local migrations, so review the complete dry-run list first. The current Sprint 0 migration creates types/tables/functions and RLS policies; it does not delete data. Existing objects with matching names would cause conflicts because it is not rerunnable SQL. Its read-only grants deliberately block browser writes, including role changes; profiles must be provisioned through trusted tooling. A single active business day remains the documented provisional operating-unit assumption. Do not repair migration history or reset Cloud to bypass errors. See [Supabase migration commands](https://supabase.com/docs/reference/cli/supabase-migration-list).

## Account process

The original `npm run seed:demo` remains local-only and refuses Cloud. Its behavior was not rewritten.

The separate Cloud helper is restricted to the exact linked project and the two requested demo identities. Inspection is read-only by default:

```powershell
node --env-file=.env.local scripts/cloud-demo.mjs
```

Explicit provisioning, if those identities are missing:

```powershell
node --env-file=.env.local scripts/cloud-demo.mjs --create
```

It creates missing Auth identities and profiles, refuses conflicting roles/inactive profiles, preserves existing passwords, and never creates business days, stock, trips or money. Existing account passwords must be supplied privately in `.env.local`; it never resets them. Do not copy keys or passwords into chat, tracked templates or shell arguments.

## Browser login

Use the running development server at http://localhost:3000/sign-in. If no server is running, start `npm.cmd run dev`. Reuse the existing server rather than starting a second Next dev process for this checkout.

| Email                          | Password location                    | Expected route     |
| ------------------------------ | ------------------------------------ | ------------------ |
| `admin@mount-kailash.example`  | `.env.local`: `DEMO_ADMIN_PASSWORD`  | `/admin/dashboard` |
| `driver@mount-kailash.example` | `.env.local`: `DEMO_DRIVER_PASSWORD` | `/driver/home`     |

Open `.env.local` privately in your editor to copy the relevant password. Test one account, sign out, then test the other. As driver, opening `/admin/dashboard` should redirect to `/driver/home`. Sign-out should prevent reopening a protected dashboard without signing in again.

To verify against the already-running server without storing browser artifacts or printing credentials:

```powershell
node --env-file=.env.local scripts/verify-cloud-login.mjs http://localhost:3000
```

The helper checks both accounts on desktop/mobile, correct dashboards, responsive navigation, driver exclusion from admin and sign-out. It uses Cloud Auth via the existing app and never mutates business data. The original `test:e2e:auth` suite launches its own dev server on port 3001 and cannot run concurrently with another Next dev process in the same checkout.
