import { createClient } from '@supabase/supabase-js';

const mustRun = process.env.RUN_INTEGRATION_TESTS === 'true';

const supabaseUrl = process.env.KODIGO_TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const anonKey = process.env.KODIGO_TEST_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.KODIGO_TEST_SUPABASE_SERVICE_ROLE_KEY;

if (!mustRun) {
  console.log('Integration tests skipped. Set RUN_INTEGRATION_TESTS=true to run checkout/stock/RLS tests.');
  process.exit(0);
}

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error('Missing Supabase integration test env vars.');
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const anon = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = crypto.randomUUID().slice(0, 8);
const adminEmail = `kodigo-admin-${runId}@example.test`;
const cashierEmail = `kodigo-cashier-${runId}@example.test`;
const password = `Test-${runId}-Password!`;

const createdUserIds = [];
const createdStoreIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function unwrap(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function createAuthUser(email, role, name) {
  const data = await unwrap(`create ${role}`, admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { role },
  }));
  const userId = data.user.id;
  createdUserIds.push(userId);
  await unwrap('upsert profile', admin.from('profiles').upsert({ id: userId, name, role }));
  return userId;
}

async function signIn(email) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await unwrap(`sign in ${email}`, client.auth.signInWithPassword({ email, password }));
  return client;
}

async function cleanup() {
  for (const storeId of createdStoreIds.reverse()) {
    await admin.from('stores').delete().eq('id', storeId);
  }
  for (const userId of createdUserIds.reverse()) {
    await admin.auth.admin.deleteUser(userId);
  }
}

try {
  const adminUserId = await createAuthUser(adminEmail, 'admin', 'Integration Admin');
  const cashierUserId = await createAuthUser(cashierEmail, 'cashier', 'Integration Cashier');

  const storeA = await unwrap('create store A', admin
    .from('stores')
    .insert({ name: `Integration A ${runId}`, address: 'Test', tax_rate: 0 })
    .select()
    .single());
  const storeB = await unwrap('create store B', admin
    .from('stores')
    .insert({ name: `Integration B ${runId}`, address: 'Test', tax_rate: 0 })
    .select()
    .single());
  createdStoreIds.push(storeA.id, storeB.id);

  await unwrap('map admin', admin.from('store_users').insert({ store_id: storeA.id, profile_id: adminUserId }));
  await unwrap('map cashier', admin.from('store_users').insert({ store_id: storeA.id, profile_id: cashierUserId }));

  const categoryA = await unwrap('create category A', admin
    .from('categories')
    .insert({ store_id: storeA.id, name: `Integration Category A ${runId}` })
    .select()
    .single());
  const categoryB = await unwrap('create category B', admin
    .from('categories')
    .insert({ store_id: storeB.id, name: `Integration Category B ${runId}` })
    .select()
    .single());

  const productA = await unwrap('create product A', admin
    .from('products')
    .insert({
      store_id: storeA.id,
      category_id: categoryA.id,
      name: `Integration Product A ${runId}`,
      sku: `SKU-A-${runId}`,
      unit: 'piece',
      cost_price: 5,
      selling_price: 10,
      current_stock: 10,
      min_stock_level: 1,
      safety_stock: 1,
      reorder_level: 2,
      lead_time_days: 1,
    })
    .select()
    .single());

  const productB = await unwrap('create product B', admin
    .from('products')
    .insert({
      store_id: storeB.id,
      category_id: categoryB.id,
      name: `Integration Product B ${runId}`,
      sku: `SKU-B-${runId}`,
      unit: 'piece',
      cost_price: 5,
      selling_price: 10,
      current_stock: 10,
      min_stock_level: 1,
      safety_stock: 1,
      reorder_level: 2,
      lead_time_days: 1,
    })
    .select()
    .single());

  const cashier = await signIn(cashierEmail);
  const saleId = crypto.randomUUID();
  await unwrap('process checkout', cashier.rpc('process_pos_sale_v2', {
    p_id: saleId,
    p_store_id: storeA.id,
    p_cashier_id: cashierUserId,
    p_subtotal: 20,
    p_tax: 0,
    p_discount: 0,
    p_total: 20,
    p_cash_received: 50,
    p_change: 30,
    p_items: [{ productId: productA.id, productName: productA.name, quantity: 2, unitPrice: 10, lineTotal: 20 }],
    p_payment_method: 'cash',
    p_payment_reference: null,
    p_discount_type: 'amount',
    p_discount_value: 0,
    p_tax_rate: 0,
  }));

  const postSaleProduct = await unwrap('read stock after sale', admin
    .from('products')
    .select('current_stock')
    .eq('id', productA.id)
    .single());
  assert(postSaleProduct.current_stock === 8, 'Checkout should decrement stock by sold quantity.');

  const inaccessibleProduct = await unwrap('RLS product scope', cashier
    .from('products')
    .select('id')
    .eq('id', productB.id));
  assert(inaccessibleProduct.length === 0, 'Cashier should not read products from an unassigned store.');

  const anonymousProducts = await unwrap('anon product scope', anon
    .from('products')
    .select('id')
    .eq('id', productA.id));
  assert(anonymousProducts.length === 0, 'Anon should not read products.');

  const adminClient = await signIn(adminEmail);
  await unwrap('void sale', adminClient.rpc('void_pos_sale', {
    p_sale_id: saleId,
    p_reason: 'integration rollback',
  }));
  const postVoidProduct = await unwrap('read stock after void', admin
    .from('products')
    .select('current_stock')
    .eq('id', productA.id)
    .single());
  assert(postVoidProduct.current_stock === 10, 'Voiding should restore stock.');

  console.log('Integration tests passed: checkout stock decrement, void stock restore, and product RLS.');
} finally {
  await cleanup();
}
