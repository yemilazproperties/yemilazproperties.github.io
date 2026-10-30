# Yemilaz Properties

Yemilaz Properties is a Nigerian property management portal for landlords, caretakers, and tenants. It uses Supabase Auth, Postgres with row-level security, and private Supabase Storage. The interface uses NGN and Africa/Lagos time.

## What is connected

- Landlords can add properties and units, invite tenants with lease details, assign caretakers to selected properties, upload private PDF agreements, review tenant acknowledgements, track maintenance, and record/confirm bank, cash, and POS payments.
- Caretakers can see assigned properties, tenant and lease details for those properties, view agreements, and update maintenance requests.
- Tenants can see their rental details and private agreements, acknowledge agreements, report maintenance, and submit payment records for landlord confirmation.
- Supabase row-level security controls record access. Agreement files are held in a private bucket. Email invitations use Supabase Auth; agreement email notices use Resend through a server-side Edge Function.

Payments are records for offline Nigerian payment methods; this version does not charge cards or connect to a bank. The typed agreement acknowledgement is a record of acknowledgement, not a verified digital-signature service.

## Run on your computer

Open PowerShell in this folder and run:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. Keep PowerShell open while using the local site. Press `Ctrl+C` there to stop it.

## Supabase setup

1. This package is configured for Supabase project `qghumlexkybfndcrkgqk` in `eu-west-1`. `config.js` contains only the project URL and publishable browser key; it must never contain a service-role key.
2. In the Supabase Dashboard, open **SQL Editor**, paste all of `supabase/schema.sql`, and run it. It preserves existing records, replaces the older recursive policies on the app tables, creates the private `rental-agreements` Storage bucket, and adds access policies.
3. Confirm your own profile role is `landlord` in `public.profiles`. If needed, run this with your own email:

   ```sql
   update public.profiles set role = 'landlord' where lower(email) = lower('YOUR_EMAIL');
   ```

   Existing properties with no owner are automatically assigned only when the database has exactly one landlord profile. If there is more than one, review and assign each property's `landlord_id` deliberately.
4. In **Authentication → URL Configuration**, set the deployed GitHub Pages site as the Site URL and add both `https://yemilazproperties.github.io/**` and `http://localhost:8000/**` to the Redirect URLs. Configure a working SMTP sender under **Authentication → SMTP Settings** for invitation emails. Supabase's default email rate limits are for development.
5. Deploy the Edge Functions below and add their secrets. For Resend, verify the sending domain and configure `EMAIL_FROM` to use that verified domain.

### Deploy Edge Functions

Install the Supabase CLI, then run these commands from this folder after signing in to the CLI:

```powershell
supabase login
supabase functions deploy invite-member --project-ref qghumlexkybfndcrkgqk
supabase functions deploy notify-agreement --project-ref qghumlexkybfndcrkgqk
supabase secrets set 'SITE_URL=https://yemilazproperties.github.io' 'RESEND_API_KEY=re_your_actual_key' 'EMAIL_FROM=Yemilaz Properties <notices@your-verified-domain.com>' --project-ref qghumlexkybfndcrkgqk
```

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions. Do not paste the service-role key into GitHub or `config.js`. If you are not using Resend yet, `invite-member` can send Supabase Auth invitations after SMTP is set; agreement email notices will wait until the Resend secrets are configured.

## Publish with GitHub Pages

Copy the contents of this package into the root of your repository `yemilazproperties/yemilazproperties.github.io`, commit, and push to `main`. In GitHub, open **Settings → Pages** and choose **Deploy from a branch**, branch `main`, folder `/ (root)`. Your sign-in URL is:

`https://yemilazproperties.github.io/`

Render is not needed for this static frontend or for the email functions. Supabase hosts the database and Edge Functions.

## Data and access

Keep RLS enabled. Before using real tenant information, use separate landlord, caretaker, and tenant accounts to review the pages and confirm that each role can see only its assigned records. Do not add private tenant documents to public GitHub Pages or public Storage buckets. See `supabase/schema.sql` for the database structure and policies.
