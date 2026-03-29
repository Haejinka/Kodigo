import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://vlnucrbsgxnetdiejnwt.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsbnVjcmJzZ3huZXRkaWVqbnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDc1ODcsImV4cCI6MjA4ODAyMzU4N30.S2j8VMQxXhxQwR4DSk67wp6-PI4oqd230bzVBwqw4Wc');
supabase.auth.signInWithPassword({ email: 'evon@example.com', password: 'password123' }).then(async () => {
   const res = await supabase.from('categories').select('*');
   console.log(res.data);
});
