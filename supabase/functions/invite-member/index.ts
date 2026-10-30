import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization = req.headers.get('Authorization');
    if (!authorization) return json({ error: 'Sign in before inviting a user.' }, 401);

    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return json({ error: 'Your session is invalid. Sign in again.' }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: caller } = await admin.from('profiles').select('role').eq('id', authData.user.id).maybeSingle();
    if (caller?.role !== 'landlord') return json({ error: 'Only the landlord can invite tenants and caretakers.' }, 403);

    const body = await req.json();
    const role = body.role;
    const email = String(body.email ?? '').trim().toLowerCase();
    const fullName = String(body.full_name ?? '').trim();
    if (!['tenant', 'caretaker'].includes(role) || !email || !fullName) {
      return json({ error: 'Provide a valid role, full name, and email address.' }, 400);
    }

    let propertyIds: string[] = [];
    let unitId: string | null = null;
    if (role === 'tenant') {
      unitId = String(body.unit_id ?? '');
      const { data: unit } = await admin.from('units').select('id,property_id').eq('id', unitId).maybeSingle();
      if (!unit) return json({ error: 'The selected unit was not found.' }, 400);
      const { data: owned } = await admin.from('properties').select('id').eq('id', unit.property_id).eq('landlord_id', authData.user.id).maybeSingle();
      if (!owned) return json({ error: 'You can only assign tenants to your own properties.' }, 403);
      const { data: existingLease } = await admin.from('leases').select('id').eq('unit_id', unitId).neq('status', 'ended').limit(1).maybeSingle();
      if (existingLease) return json({ error: 'That unit already has a current or pending tenant. Choose another unit.' }, 409);
      const startDate = String(body.start_date ?? '');
      const endDate = String(body.end_date ?? '');
      if (!startDate || !endDate || endDate < startDate || Number(body.annual_rent) < 0) {
        return json({ error: 'Enter a valid lease period and annual rent.' }, 400);
      }
    } else {
      propertyIds = Array.isArray(body.property_ids) ? [...new Set(body.property_ids.map(String))] : [];
      if (!propertyIds.length) return json({ error: 'Assign the caretaker to at least one property.' }, 400);
      const { data: owned } = await admin.from('properties').select('id').eq('landlord_id', authData.user.id).in('id', propertyIds);
      if (!owned || owned.length !== propertyIds.length) return json({ error: 'One or more properties are not owned by your account.' }, 403);
    }

    const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
    if (!siteUrl) return json({ error: 'Set the SITE_URL secret before sending invitations.' }, 500);
    const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: `${siteUrl}/`,
    });
    if (inviteError || !invite.user) {
      const message = inviteError?.message ?? 'Could not create the invitation.';
      return json({ error: message.toLowerCase().includes('already')
        ? 'That email already has a Yemilaz Properties account. Ask them to sign in; contact support if their role needs changing.'
        : message }, 400);
    }

    const { error: profileError } = await admin.from('profiles').upsert({
      id: invite.user.id, email, full_name: fullName, role,
    }, { onConflict: 'id' });
    if (profileError) throw profileError;

    if (role === 'tenant') {
      const { error } = await admin.from('leases').insert({
        unit_id: unitId, tenant_id: invite.user.id, start_date: body.start_date,
        end_date: body.end_date, annual_rent: Number(body.annual_rent), status: 'pending',
      });
      if (error) throw error;
    } else {
      const { error } = await admin.from('property_caretakers').insert(
        propertyIds.map((property_id) => ({ property_id, caretaker_id: invite.user!.id })),
      );
      if (error) throw error;
    }
    return json({ ok: true, invited: email, role });
  } catch (error) {
    console.error('invite-member failed', error);
    return json({ error: error instanceof Error ? error.message : 'Invitation failed.' }, 500);
  }
});
