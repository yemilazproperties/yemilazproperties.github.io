# Hearth Property Manager

A first-pass property management dashboard for a landlord with a caretaker team and tenants. Supabase email/password sign-in and landlord property creation are connected. Other screens still use demo data and are not ready for real tenant records yet.

## Open locally

Run a local server from this folder so Supabase Auth can use a normal web origin:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000`. Add this local URL and your GitHub Pages URL to Supabase Auth's allowed redirect URLs.

## First version includes

- Portfolio overview, properties, tenants, caretaker profiles, agreements, maintenance, and rent screens.
- Responsive layouts for desktop and mobile.
- Working local demo forms for adding properties, tenants, and caretakers.
- Tenant search and Supabase SQL schema with initial row-level security policies.

## Supabase setup

1. This starter is configured for project `qghumlexkybfndcrkgqk` in `eu-west-1` (Ireland).
2. Run `supabase/schema.sql` in that project's SQL Editor. New Auth accounts get a tenant profile by default.
3. Create your first Auth account in the Supabase Dashboard. In the SQL Editor, promote only your own account to landlord with `update public.profiles set role='landlord' where email='YOUR_EMAIL';`.
4. Sign in on the site with that account. The Properties page reads and creates records in Supabase.
5. Add private Storage policies for the `rental-agreements` bucket before uploading any real agreements. Keep signed agreements private.
6. The project URL and publishable key are in `config.js`. They are browser credentials and can be committed for GitHub Pages; they are not secrets. Keep RLS enabled and never add a Supabase secret/service-role key or email-provider credential to this repository.
7. Invitations and agreement email delivery need a Supabase Edge Function and an email provider. Store provider credentials in Supabase function secrets. Email should link to the authenticated tenant portal, not expose a public agreement URL.

Before using real tenant information, review the RLS policies against your account setup and check landlord, caretaker, and tenant access separately. Landlord sign-in and property creation are connected; caretaker/tenant portals, invitations, document signing, payment processing, and agreement email delivery are not yet implemented.

## Hosting

This is a static frontend intended for GitHub Pages; Render is not needed for the current build. The interface uses Nigerian English, Africa/Lagos time, Nigerian addresses, and NGN (₦). The Supabase project is hosted in `eu-west-1`; that is the database region, separate from the website's Nigerian locale. Since the GitHub Pages site is public, only the app shell is public—tenant records remain behind Supabase sign-in and RLS. Add your GitHub Pages domain to Supabase Auth's allowed redirect URLs before using password reset or email links. A Supabase Edge Function can handle invitations and email without a separate Render service.

## Suggested next step

Next, add secure landlord invitations and role-specific caretaker/tenant portals. Do not upload actual rental agreements until private Storage policies and tenant access checks are in place.
