import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `VIP-${body}`;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Function environment is missing Supabase credentials.');
    }

    const authorization = req.headers.get('Authorization') ?? '';
    const accessToken = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Unauthorized: missing access token.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    // Use a server-only client for both JWT verification and authorization.
    // The role decision comes from profiles, never user-editable metadata.
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: invalid or expired session.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const { data: assurance, error: assuranceError } =
      await supabaseAdmin.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
    if (assuranceError) throw assuranceError;
    if (assurance.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2') {
      return new Response(JSON.stringify({ error: 'Complete MFA verification before generating invite codes.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || profile?.role !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Access Denied: Only Super Admins can generate codes.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    let inviteCode = '';
    let insertError: { code?: string; message?: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      inviteCode = generateInviteCode();
      const result = await supabaseAdmin
        .from('invite_codes')
        .insert({ code: inviteCode, role: 'admin', created_by: user.id });
      insertError = result.error;
      if (!insertError) break;
      if (insertError.code !== '23505') throw insertError;
    }
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ success: true, code: inviteCode }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: unknown) {
    console.error('generate-invite failed', error);
    const message = error instanceof Error ? error.message : 'Failed to generate invite code.';
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
