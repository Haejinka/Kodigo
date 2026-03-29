import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
const supabase = createClient('https://vlnucrbsgxnetdiejnwt.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsbnVjcmJzZ3huZXRkaWVqbnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDc1ODcsImV4cCI6MjA4ODAyMzU4N30.S2j8VMQxXhxQwR4DSk67wp6-PI4oqd230bzVBwqw4Wc');

async function test() {
  await supabase.auth.signInWithPassword({ email: 'evon@example.com', password: 'password123' });
  const { data: stores } = await supabase.from('stores').select('id');
  if(!stores || stores.length === 0) { console.log('no stores'); return; }
  const storeId = stores[0].id;

  const { error: err1 } = await supabase.from('suppliers').insert({
    store_id: storeId,
    name: 'Test Supplier',
    contact: 'Test Contact',
    email: 'test@example.com',
    phone: '1234567890',
    address: 'Test Address',
    lead_time_days: 1
  });
  console.log('Supplier insert error:', err1?.message || 'Success');

  const { error: err2 } = await supabase.from('products').insert({
    store_id: storeId,
    name: 'Test Product',
    sku: 'SKU1234',
    barcode: '12345678901',
    category_id: 'c1',
    cost_price: 10,
    selling_price: 20,
    current_stock: 10,
    min_stock_level: 5,
    safety_stock: 5,
    reorder_level: 5,
    lead_time_days: 1,
    unit: 'piece'
  });
  console.log('Product insert error:', err2?.message || 'Success');
}
test();
