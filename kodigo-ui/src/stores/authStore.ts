import { create } from 'zustand';
import type { UserRole, Store } from '@/types';
import { supabase } from '@/lib/supabase';

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
  tax_rate?: number | string | null;
  taxRate?: number | string | null;
  registered_name?: string | null;
  business_name?: string | null;
  tin?: string | null;
  branch_code?: string | null;
  vat_status?: 'vat' | 'non_vat' | null;
  document_label?: string | null;
  terminal_identifier?: string | null;
  bir_registration_info?: string | null;
  accreditation_info?: string | null;
  permit_info?: string | null;
  invoice_prefix?: string | null;
  logo_path?: string | null;
  phone?: string | null;
  email?: string | null;
};

const toStore = (row: StoreRow): Store => ({
  id: row.id,
  name: row.name,
  address: row.address ?? '',
  taxRate: Number(row.taxRate ?? row.tax_rate ?? 0),
  registeredName: row.registered_name ?? undefined,
  businessName: row.business_name ?? undefined,
  tin: row.tin ?? undefined,
  branchCode: row.branch_code ?? undefined,
  vatStatus: row.vat_status === 'vat' ? 'vat' : 'non_vat',
  documentLabel: row.document_label || 'Sales Invoice',
  terminalIdentifier: row.terminal_identifier ?? undefined,
  birRegistrationInfo: row.bir_registration_info ?? undefined,
  accreditationInfo: row.accreditation_info ?? undefined,
  permitInfo: row.permit_info ?? undefined,
  invoicePrefix: row.invoice_prefix || 'INV',
  logoPath: row.logo_path ?? undefined,
  phone: row.phone ?? undefined,
  email: row.email ?? undefined,
});

const toStores = (rows: StoreRow[] | null | undefined): Store[] => (rows ?? []).map(toStore);

// Helper to reliably resolve user role from various possible DB/metadata sources
const resolveRole = (user: any, profile: any): UserRole | null => {
  const checkRole = (r: any): UserRole | null => {
    if (!r) return null;
    const normalized = String(r).toLowerCase().trim();
    if (['admin', 'cashier', 'inventory', 'super_admin'].includes(normalized)) {
      return normalized as UserRole;
    }
    return null;
  };

  const explicitlySet = 
    checkRole(profile?.role) ||
    checkRole(user?.app_metadata?.role);

  if (explicitlySet) return explicitlySet;

  // App metadata is server-controlled in Supabase Auth; user metadata is intentionally ignored.
  if (user?.app_metadata?.is_super_admin === true) return 'super_admin';
  if (user?.app_metadata?.is_admin === true) return 'admin';
  
  // If the user literally has no row in `public.profiles` due to a DB trigger bug during creation,
  // we must refuse entry to prevent corrupted state instead of defaulting to cashier.
  return null;
};

// Helper to fetch stores for user
const fetchUserStores = async (role: string | null) => {
  if (role === 'super_admin') {
    return [];
  } else {
    // Note: Due to RLS, they only see stores they are mapped to. 
    // We can just fetch from 'stores' and RLS will filter it.
    const { data: stores } = await supabase.from('stores').select(
      'id, name, address, tax_rate, registered_name, business_name, tin, branch_code, vat_status, document_label, terminal_identifier, bir_registration_info, accreditation_info, permit_info, invoice_prefix, logo_path, phone, email'
    );
    return toStores(stores);
  }
};

interface AuthState {
  user: any | null;
  role: UserRole | null;
  profile: any | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  stores: Store[];
  activeStoreId: string | 'all' | null;
  setActiveStoreId: (storeId: string | 'all') => void;
  addStore: (name: string, address: string, taxRate: number) => Promise<Store | null>;
  updateStore: (id: string, name: string, address: string, taxRate: number) => Promise<boolean>;
  deleteStore: (id: string) => Promise<boolean>;
  refreshStores: () => Promise<void>;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const resetAuthState: Pick<
  AuthState,
  'user' | 'role' | 'profile' | 'isAuthenticated' | 'isLoading' | 'error' | 'stores' | 'activeStoreId'
> = {
  user: null,
  role: null,
  profile: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  stores: [],
  activeStoreId: null,
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  role: null,
  profile: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  stores: [],
  activeStoreId: null,

  setActiveStoreId: (storeId: string | 'all') => {
    localStorage.setItem('kodigo_active_store_id', storeId);
    if (storeId !== 'all') localStorage.setItem('kodigo_last_store_id', storeId);
    set({ activeStoreId: storeId });
  },

  addStore: async (name: string, address: string, taxRate: number) => {
    const { user, profile } = get();
    if (!user) return null;

    // Call the RPC function to create the store and map the user in a single atomic transaction
    const { data: store, error: rpcError } = await supabase.rpc('create_store_with_owner', {
      p_name: name,
      p_address: address,
      p_tax_rate: taxRate,
    });

    if (rpcError) {
      console.error("Error creating store via RPC", rpcError);
      throw new Error(rpcError.message || JSON.stringify(rpcError));
    }
    
    // Refresh stores
    const role = resolveRole(user, profile);
    const stores = await fetchUserStores(role);
    const createdStore = Array.isArray(store) ? store[0] : store;
    set({ stores });
    return createdStore ? toStore(createdStore as StoreRow) : null;
  },

  updateStore: async (id: string, name: string, address: string, taxRate: number) => {
    const { user, profile } = get();
    if (!user) return false;

    const { data: updatedStore, error } = await supabase
      .from('stores')
      .update({ name, address, tax_rate: taxRate })
      .eq('id', id)
      .select('id, name, address, tax_rate, registered_name, business_name, tin, branch_code, vat_status, document_label, terminal_identifier, bir_registration_info, accreditation_info, permit_info, invoice_prefix, logo_path, phone, email')
      .maybeSingle();

    if (error || !updatedStore) {
      console.error("Error updating store", error ?? 'No matching store was updated');
      return false;
    }

    // Refresh stores
    const role = resolveRole(user, profile);
    const stores = await fetchUserStores(role);
    set({ stores });
    return true;
  },
  deleteStore: async (id: string) => {
    const { user, profile } = get();
    if (!user) return false;

    const { error } = await supabase
      .from('stores')
      .delete()
      .eq('id', id);

    if (error) {
      console.error("Error deleting store", error);
      return false;
    }

    // Refresh stores
    const role = resolveRole(user, profile);
    const stores = await fetchUserStores(role);
    
    // If the active store was deleted, switch to the first remaining store or 'all'
    const { activeStoreId } = get();
    let newActiveStoreId = activeStoreId;
    if (activeStoreId === id) {
      newActiveStoreId = stores.length > 0 ? stores[0].id : null;
      if (newActiveStoreId) {
        localStorage.setItem('kodigo_active_store_id', newActiveStoreId);
      } else {
        localStorage.removeItem('kodigo_active_store_id');
      }
    }
    
    set({ stores, activeStoreId: newActiveStoreId });
    return true;
  },
  refreshStores: async () => {
    const { user, profile, activeStoreId } = get();
    if (!user) return;
    const role = resolveRole(user, profile);
    const stores = await fetchUserStores(role);
    const nextActiveStoreId = activeStoreId === 'all' || stores.some((store) => store.id === activeStoreId)
      ? activeStoreId
      : stores[0]?.id ?? null;
    set({ stores, activeStoreId: nextActiveStoreId });
  },
  initialize: async () => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) throw sessionError;
      
      if (session?.user) {
        // Fetch the extended profile from our table to get the role
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, name, role, avatar_url')
          .eq('id', session.user.id)
          .single();

        if (profileError) {
          console.error("Error initializing profile:", profileError);
        }

        const computedRole = resolveRole(session.user, profile);
        const stores = await fetchUserStores(computedRole);

        const savedStoreId = localStorage.getItem('kodigo_active_store_id');
        let initialStoreId = null;
        if (savedStoreId === 'all' && (computedRole === 'admin' || computedRole === 'super_admin' || stores.length > 1)) {
          initialStoreId = 'all';
        } else if (savedStoreId && stores.some(s => s.id === savedStoreId)) {
          initialStoreId = savedStoreId;
        } else if (stores?.length) {
          initialStoreId = stores[0].id;
        }
        if (initialStoreId && initialStoreId !== 'all') {
          localStorage.setItem('kodigo_last_store_id', initialStoreId);
        }
        
        set({
          user: session.user,
          profile,
          role: computedRole,
          stores,
          activeStoreId: initialStoreId,
          isAuthenticated: true,
          isLoading: false
        });
      } else {
        set(resetAuthState);
      }

      // Listen for auth changes
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          if (session?.user) {
            const { data: profile, error } = await supabase
              .from('profiles')
              .select('id, name, role, avatar_url')
              .eq('id', session.user.id)
              .single();
              
            if (error) console.error("onAuthStateChange profile fetch error:", error);

            const computedRole = resolveRole(session.user, profile);
            const stores = await fetchUserStores(computedRole);

            set({
              user: session.user,
              profile,
              role: computedRole,
              stores,
              activeStoreId: stores?.length ? stores[0].id : null,
              isAuthenticated: true
            });
            if (stores?.[0]?.id) localStorage.setItem('kodigo_last_store_id', stores[0].id);
          }
        } else if (event === 'SIGNED_OUT') {
          set(resetAuthState);
        }
      });
    } catch (error: any) {
      console.error('Auth initialization error:', error);
      set({ isLoading: false });
    }
  },

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      
      if (data.session?.user) {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, name, role, avatar_url')
          .eq('id', data.session.user.id)
          .single();

        if (profileError) {
          console.error("Error fetching profile during login:", profileError);
        }

        const computedRole = resolveRole(data.session.user, profile);
        console.log("Fetched profile role:", computedRole);

        const stores = await fetchUserStores(computedRole);

        set({
          user: data.session.user,
          profile,
          role: computedRole,
          stores,
          activeStoreId: stores?.length ? stores[0].id : null,
          isAuthenticated: true,
          isLoading: false
        });
        if (stores?.[0]?.id) localStorage.setItem('kodigo_last_store_id', stores[0].id);
      } else {
        set({ isLoading: false });
      }
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Invalid email or password.' });
    }
  },

  logout: async () => {
    localStorage.removeItem('kodigo_active_store_id');
    set({ isLoading: true, error: null });

    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      // Clear client auth state even if the remote sign-out request fails so
      // the app does not immediately navigate the user back into a protected route.
      set(resetAuthState);
    }
  },
}));



