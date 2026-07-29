import { supabase } from '@/lib/supabase';
import type { User, UserRole } from '@/types';

type ManageableRole = Extract<UserRole, 'admin' | 'cashier' | 'inventory'>;

async function invokeAdminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export async function listManagedUsers(storeId?: string): Promise<User[]> {
  const data = await invokeAdminUsers<{ users: User[] }>({ action: 'list', storeId });
  return data.users;
}

export async function createManagedUser(input: {
  name: string;
  email: string;
  password: string;
  role: ManageableRole;
  storeId: string;
  storeIds?: string[];
}): Promise<User> {
  const data = await invokeAdminUsers<{ user: User }>({ action: 'create', ...input });
  return data.user;
}

export async function updateManagedUser(input: {
  userId: string;
  name: string;
  email: string;
  role: ManageableRole;
  storeId: string;
  storeIds?: string[];
}): Promise<User> {
  const data = await invokeAdminUsers<{ user: User }>({ action: 'update', ...input });
  return data.user;
}

export async function removeManagedUser(userId: string): Promise<void> {
  await invokeAdminUsers<{ success: boolean }>({ action: 'remove', userId });
}
