import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const authorization = req.headers.get('Authorization');
    if (!authorization) return json({ error: 'Sign in before sending an agreement.' }, 401);
    const callerClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Your session is invalid. Sign in again.' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: caller } = await admin.from('profiles').select('role').eq('id', authData.user.id).maybeSingle();
    if (caller?.role !== 'landlord') return json({ error: 'Only the landlord can email agreements.' }, 403);
    const { agreement_id } = await req.json();
    if (!agreement_id) return json({ error: 'Agreement ID is required.' }, 400);

    const { data: agreement, error: agreementError } = await admin.from('agreements')
      .select('id,status,lease_id').eq('id', agreement_id).maybeSingle();
    if (agreementError || !agreement) return json({ error: 'Agreement not found.' }, 404);
    const { data: lease } = await admin.from('leases').select('id,tenant_id,unit_id,start_date').eq('id', agreement.lease_id).maybeSingle();
    if (!lease) return json({ error: 'The linked lease was not found.' }, 404);
    const { data: unit } = await admin.from('units').select('unit_name,property_id').eq('id', lease.unit_id).maybeSingle();
    if (!unit) return json({ error: 'The linked unit was not found.' }, 404);
    const { data: property } = await admin.from('properties').select('id,name,landlord_id').eq('id', unit.property_id).maybeSingle();
    if (property?.landlord_id !== authData.user.id) return json({ error: 'You do not own the property for this lease.' }, 403);
    const { data: tenant } = await admin.from('profiles').select('email,full_name').eq('id', lease.tenant_id).maybeSingle();
    if (!tenant?.email) return json({ error: 'The tenant does not have an email address on their profile.' }, 400);

    const apiKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('EMAIL_FROM');
    const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
    if (!apiKey || !from || !siteUrl) return json({ error: 'Set RESEND_API_KEY, EMAIL_FROM, and SITE_URL secrets.' }, 500);
    const tenantName = escapeHtml(tenant.full_name || 'Tenant');
    const propertyName = escapeHtml(property.name);
    const unitName = escapeHtml(unit.unit_name);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [tenant.email], subject: `Rental agreement ready: ${property.name}`,
        html: `<p>Hello ${tenantName},</p><p>A rental agreement for <strong>${propertyName} · ${unitName}</strong> is ready in your Yemilaz Properties account.</p><p><a href="${siteUrl}/#agreements">Sign in to review your agreement</a></p><p>For your security, the private document is available after signing in.</p>`,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('Resend rejected agreement email', detail);
      return json({ error: 'Email provider could not send the notification. Check the verified sender and Resend configuration.' }, 502);
    }
    return json({ ok: true, sent_to: tenant.email });
  } catch (error) {
    console.error('notify-agreement failed', error);
    return json({ error: error instanceof Error ? error.message : 'Agreement email failed.' }, 500);
  }
});
