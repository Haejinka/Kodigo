import { createClient } from '@supabase/supabase-js';
const url = 'https://vlnucrbsgxnetdiejnwt.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsbnVjcmJzZ3huZXRkaWVqbnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDc1ODcsImV4cCI6MjA4ODAyMzU4N30.S2j8VMQxXhxQwR4DSk67wp6-PI4oqd230bzVBwqw4Wc';
const supabase = createClient(url, key);

(async () => {
    // 1. Authenticate with a known dev user or create a new user.
    const resCount = await supabase.from('invite_codes').select('*').eq('role', 'admin').eq('is_used', false).limit(1);
    let code = resCount.data?.[0]?.code;

    if (!code) {
        // Insert a new invite code real quick using master key - actually anon key can't.
        // Let's just create an invite code directly in SQL via edge if we could.
        // Since we can't, let's login as someone else maybe?
        // Let's just call the RPC anonymously and see if the *signature* is found.
        const { error: anonErr } = await supabase.rpc('create_store_with_owner', {
            p_name: 'RPC Test Store',
            p_address: '123 Test St',
            p_tax_rate: 10
        });
        console.log("Anon call error tells us if function exists:", JSON.stringify(anonErr || 'success'));
        return;
    }
    
    const email = `test+${Date.now()}@example.com`;
    const { data: auth, error: authErr } = await supabase.auth.signUp({
        email,
        password: 'password123',
        options: {
            data: { name: 'Test Admin', invite_code: code }
        }
    });

    if (authErr && !auth?.user) {
        console.error("Signup failed", authErr);
        return;
    }

    console.log("Logged in as", auth.user.id);
    
    // Try to create the store
    const { data, error } = await supabase.rpc('create_store_with_owner', {
        p_name: 'RPC Test Store',
        p_address: '123 Test St',
        p_tax_rate: 10
    });

    console.log("RPC Error:", JSON.stringify(error, null, 2));
    console.log("RPC Data:", JSON.stringify(data, null, 2));
})();