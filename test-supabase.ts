import { createClient } from "npm:@supabase/supabase-js";
const url = 'https://vlnucrbsgxnetdiejnwt.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsbnVjcmJzZ3huZXRkaWVqbnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDc1ODcsImV4cCI6MjA4ODAyMzU4N30.S2j8VMQxXhxQwR4DSk67wp6-PI4oqd230bzVBwqw4Wc';
const supabase = createClient(url, key);

console.log("Starting test...");
const start = Date.now();
const res = await supabase.from('stores').insert({ name: 'Test Store', address: 'Test', tax_rate: 0 }).select().single();
console.log("Finished in", Date.now() - start, "ms", JSON.stringify(res));
