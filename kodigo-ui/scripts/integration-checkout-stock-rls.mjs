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

  const saleItemSnapshot = await unwrap('read sale item snapshots', admin
    .from('sale_items')
    .select('product_name,category_name,unit_price,cost_price,line_total')
    .eq('sale_id', saleId)
    .single());
  assert(saleItemSnapshot.product_name === productA.name, 'Sale item should snapshot product name.');
  assert(saleItemSnapshot.category_name === categoryA.name, 'Sale item should snapshot category name.');
  assert(Number(saleItemSnapshot.unit_price) === 10, 'Sale item should snapshot selling price.');
  assert(Number(saleItemSnapshot.cost_price) === 5, 'Sale item should snapshot cost price.');
  assert(Number(saleItemSnapshot.line_total) === 20, 'Sale item should snapshot line total.');

  await unwrap('change product after sale', admin
    .from('products')
    .update({ name: `Renamed Product A ${runId}`, selling_price: 99, cost_price: 77 })
    .eq('id', productA.id));
  await unwrap('rename category after sale', admin
    .from('categories')
    .update({ name: `Renamed Category A ${runId}` })
    .eq('id', categoryA.id));

  const historicalSnapshot = await unwrap('read historical sale item after product change', admin
    .from('sale_items')
    .select('product_name,category_name,unit_price,cost_price,line_total')
    .eq('sale_id', saleId)
    .single());
  assert(historicalSnapshot.product_name === productA.name, 'Product rename must not change old sale item name.');
  assert(historicalSnapshot.category_name === categoryA.name, 'Category rename must not change old sale item category.');
  assert(Number(historicalSnapshot.unit_price) === 10, 'Product price change must not change old sale item price.');
  assert(Number(historicalSnapshot.cost_price) === 5, 'Product cost change must not change old sale item cost.');

  const reportLine = await unwrap('read historical report line view', admin
    .from('v_sales_report_lines')
    .select('product_name,category_name,unit_price,cost_price,line_total')
    .eq('sale_id', saleId)
    .single());
  assert(reportLine.product_name === productA.name, 'Report line view should use sale snapshot product name.');
  assert(reportLine.category_name === categoryA.name, 'Report line view should use sale snapshot category.');
  assert(Number(reportLine.unit_price) === 10, 'Report line view should use sale snapshot price.');

  const riceProduct = await unwrap('create rice product', admin
    .from('products')
    .insert({
      store_id: storeA.id,
      category_id: categoryA.id,
      name: `Jasmine Rice ${runId}`,
      sku: `RICE-${runId}`,
      unit: 'kg',
      cost_price: 40,
      selling_price: 55,
      current_stock: 100,
      min_stock_level: 5,
      safety_stock: 5,
      reorder_level: 10,
      lead_time_days: 1,
    })
    .select()
    .single());

  const kiloOption = await unwrap('create rice kilo option', admin
    .from('product_selling_options')
    .insert({
      store_id: storeA.id,
      product_id: riceProduct.id,
      kind: 'kilo',
      label: 'kilo',
      unit_label: 'kg',
      quantity_value: 1,
      quantity_unit: 'kg',
      stock_quantity: 100,
      selling_price: 55,
      low_stock_threshold: 5,
      is_default: true,
      is_active: true,
    })
    .select()
    .single());

  const sack25Option = await unwrap('create rice 25kg sack option', admin
    .from('product_selling_options')
    .insert({
      store_id: storeA.id,
      product_id: riceProduct.id,
      kind: 'sack',
      label: '25 kg sack',
      unit_label: 'sack',
      quantity_value: 25,
      quantity_unit: 'kg',
      stock_quantity: 5,
      selling_price: 1350,
      low_stock_threshold: 1,
      is_default: false,
      is_active: true,
    })
    .select()
    .single());

  const riceSaleId = crypto.randomUUID();
  await unwrap('process rice unit checkout', cashier.rpc('process_pos_sale_v2', {
    p_id: riceSaleId,
    p_store_id: storeA.id,
    p_cashier_id: cashierUserId,
    p_subtotal: 6775,
    p_tax: 0,
    p_discount: 0,
    p_total: 6775,
    p_cash_received: 7000,
    p_change: 225,
    p_items: [
      { productId: riceProduct.id, sellingOptionId: kiloOption.id, quantity: 25 },
      { productId: riceProduct.id, sellingOptionId: sack25Option.id, quantity: 4 },
    ],
    p_payment_method: 'cash',
    p_payment_reference: null,
    p_discount_type: 'amount',
    p_discount_value: 0,
    p_tax_rate: 0,
  }));

  const riceLines = await unwrap('read rice sale lines', admin
    .from('sale_items')
    .select('selling_option_id,selling_option_label,unit_label,package_size,package_unit,quantity,unit_price,line_total')
    .eq('sale_id', riceSaleId));
  const kiloLine = riceLines.find((line) => line.selling_option_id === kiloOption.id);
  const sackLine = riceLines.find((line) => line.selling_option_id === sack25Option.id);
  assert(kiloLine, 'Rice kilo sale line should be recorded separately.');
  assert(sackLine, 'Rice 25 kg sack sale line should be recorded separately.');
  assert(Number(kiloLine.quantity) === 25 && Number(kiloLine.unit_price) === 55, 'Rice kilo line should keep kilo quantity and price.');
  assert(Number(sackLine.quantity) === 4 && Number(sackLine.unit_price) === 1350, 'Rice sack line should keep sack quantity and price.');
  assert(Number(sackLine.package_size) === 25 && sackLine.package_unit === 'kg', 'Rice sack line should snapshot sack size.');

  await unwrap('change rice selling option after sale', admin
    .from('product_selling_options')
    .update({ label: '25 kg sack changed', selling_price: 1500 })
    .eq('id', sack25Option.id));
  const historicalRiceSack = await unwrap('read historical rice sack after option change', admin
    .from('sale_items')
    .select('selling_option_label,unit_price,line_total')
    .eq('sale_id', riceSaleId)
    .eq('selling_option_id', sack25Option.id)
    .single());
  assert(historicalRiceSack.selling_option_label === '25 kg sack', 'Selling option rename must not change old rice sale line.');
  assert(Number(historicalRiceSack.unit_price) === 1350, 'Selling option price change must not change old rice sale line.');

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
