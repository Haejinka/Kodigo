import { create } from 'zustand';
import type { UserRole, Store } from '@/types';
import { supabase } from '@/lib/supabase';

// Helper to reliably resolve user role from various possible DB/metadata sources
const resolveRole = (user: any, profile: any): UserRole | null => {
  const checkRole = (r: any): UserRole | null => {
    if (!r) return null;
    const normalized = String(r).toLowerCase().trim();
    if (['admin', 'cashier', 'super_admin'].includes(normalized)) {
      return normalized as UserRole;
    }
    return null;
  };

  const explicitlySet = 
    checkRole(profile?.role) ||
    checkRole(user?.user_metadata?.role) ||
    checkRole(user?.app_metadata?.role) ||
    (user?.role && user.role !== 'authenticated' && user.role !== 'anon' ? checkRole(user.role) : null);

  if (explicitlySet) return explicitlySet;

  // Rescue checks for common manual DB modifications
  if (user?.app_metadata?.is_super_admin === true || user?.user_metadata?.is_super_admin === true) return 'super_admin';
  if (user?.app_metadata?.is_admin === true || user?.user_metadata?.is_admin === true) return 'admin';
  
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
    const { data: stores } = await supabase.from('stores').select('*');
    return stores || [];
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
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

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
    set({ stores: stores as Store[] });
    return store;
  },

  updateStore: async (id: string, name: string, address: string, taxRate: number) => {
    const { user, profile } = get();
    if (!user) return false;

    const { error } = await supabase
      .from('stores')
      .update({ name, address, tax_rate: taxRate })
      .eq('id', id);

    if (error) {
      console.error("Error updating store", error);
      return false;
    }

    // Refresh stores
    const role = resolveRole(user, profile);
    const stores = await fetchUserStores(role);
    set({ stores: stores as Store[] });
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
      newActiveStoreId = stores.length > 0 ? (stores[0] as Store).id : null;
      if (newActiveStoreId) {
        localStorage.setItem('kodigo_active_store_id', newActiveStoreId);
      } else {
        localStorage.removeItem('kodigo_active_store_id');
      }
    }
    
    set({ stores: stores as Store[], activeStoreId: newActiveStoreId });
    return true;
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
        
        set({
          user: session.user,
          profile,
          role: computedRole,
          stores: stores as Store[],
          activeStoreId: initialStoreId,
          isAuthenticated: true,
          isLoading: false
        });
      } else {
        set({
          user: null,
          profile: null,
          role: null,
          stores: [],
          activeStoreId: null,
          isAuthenticated: false,
          isLoading: false
        });
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
              stores: stores as Store[],
              activeStoreId: stores?.length ? stores[0].id : null,
              isAuthenticated: true
            });
          }
        } else if (event === 'SIGNED_OUT') {
          set({ user: null, profile: null, role: null, stores: [], activeStoreId: null, isAuthenticated: false });
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
          stores: stores as Store[],
          activeStoreId: stores?.length ? stores[0].id : null,
          isAuthenticated: true,
          isLoading: false
        });
      } else {
        set({ isLoading: false });
      }
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Invalid email or password.' });
    }
  },

  logout: async () => {
    localStorage.removeItem('kodigo_active_store_id');
    await supabase.auth.signOut();
  },
}));



