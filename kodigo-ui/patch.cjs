
const fs = require('fs');
const path = 'src/stores/productStore.ts';
let code = fs.readFileSync(path, 'utf8');
if (!code.includes('fetchCategories')) {
  code = code.replace('interface ProductStore {', 'interface ProductStore {\n  categories: Category[];\n  fetchCategories: (storeId: string) => Promise<void>;');
  code = code.replace('export const useProductStore = create<ProductStore>((set, get) => ({', 'export const useProductStore = create<ProductStore>((set, get) => ({\n  categories: [],\n');
  const categoriesFn = \
  fetchCategories: async (storeId) => {
    if (!storeId || storeId === 'all') {
      set({ categories: CATEGORIES });
      return;
    }
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const { data, error } = await supabase.from('categories').select('*').eq('store_id', storeId);
      if (error) throw error;
      
      if (!data || data.length === 0) {
        // Seed default categories
        const defaults = ['Beverages', 'Snacks', 'Personal Care', 'Canned Goods', 'Condiments', 'Dairy', 'Household', 'Tobacco'];
        const newCats = defaults.map(name => ({
          id: crypto.randomUUID(),
          store_id: storeId,
          name
        }));
        await supabase.from('categories').insert(newCats);
        set({ categories: newCats.map(c => ({ id: c.id, name: c.name })) });
      } else {
        set({ categories: data.map(c => ({ id: c.id, name: c.name })) });
      }
    } catch (err) {
      console.error('Failed to fetch/seed categories', err);
      // Fallback
      set({ categories: CATEGORIES });
    }
  },\;
  code = code.replace('fetchProducts: async () => {', categoriesFn + '\n\n  fetchProducts: async () => {');
  code = code.replace(/CATEGORIES\\\.find/g, 'get().categories.find');
  fs.writeFileSync(path, code);
  console.log('Patched productStore.ts');
}
