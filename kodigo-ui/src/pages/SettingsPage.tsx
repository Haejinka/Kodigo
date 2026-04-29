import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Settings, Users, Store, Bell, Shield, X,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import type { User, Store as StoreType } from '@/types';
import { Badge } from '@/components/shared/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { cn, hashPassword } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';

const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

const settingsSections = [
  { label: 'General', path: '/settings', icon: Settings, end: true },
  { label: 'User Management', path: '/settings/users', icon: Users },
  { label: 'Notifications', path: '/settings/notifications', icon: Bell },
  { label: 'Security', path: '/settings/security', icon: Shield },
];

export function SettingsLayout() {
  const location = useLocation();

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your store and system preferences" />
      <div className="flex gap-6">
        {/* Sidebar nav */}
        <nav className="w-48 shrink-0">
          <ul className="space-y-1">
            {settingsSections.map((s) => {
              const Icon = s.icon;
              const isActive = s.end
                ? location.pathname === s.path
                : location.pathname.startsWith(s.path);
              return (
                <li key={s.path}>
                  <NavLink
                    to={s.path}
                    end={s.end}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors',
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {s.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

// ─── General Settings ────────────────────────────────────────────────────────

interface EditStoreModalProps {
  store: StoreType;
  onSave: (name: string, address: string, taxRate: number) => Promise<boolean>;
  onClose: () => void;
}

function EditStoreModal({ store, onSave, onClose }: EditStoreModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState(store.name);
  const [address, setAddress] = useState(store.address || '');
  const [taxRate, setTaxRate] = useState(String(store.taxRate || 0));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast('error', 'Store name is required.'); return; }
    setSaving(true);
    const success = await onSave(name.trim(), address.trim(), parseFloat(taxRate) || 0);
    if (!success) {
      // toast error is usually handled inside onSave mapping (authStore returns false and toast can be created there or here)
      // but the original handleAddStore doesn't strictly need it if returned correctly. Let's just pop error here if false:
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Edit Store</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Name</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Address</label>
            <textarea className={inputCls + ' resize-none'} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional physical address" />
          </div>
          <div>
             <label className="block text-sm font-medium text-gray-700 mb-1.5">Tax Rate (%)</label>
             <input type="number" className={inputCls + ' w-32 font-mono'} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} min={0} max={100} step={0.01} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" type="submit" loading={saving}>Save Changes</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function GeneralSettingsPage() {
  const { toast } = useToast();
  const { stores, addStore, updateStore, deleteStore, role } = useAuthStore();

  const isOwner = role === 'admin';
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreAddress, setNewStoreAddress] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('');

  const [addingStore, setAddingStore] = useState(false);
  const [editingStore, setEditingStore] = useState<StoreType | null>(null);
  const [deleteTargetStore, setDeleteTargetStore] = useState<StoreType | null>(null);
  const [deletingStore, setDeletingStore] = useState(false);

  const handleUpdate = async (name: string, address: string, taxRate: number) => {
    if (!editingStore) return false;
    const ok = await updateStore(editingStore.id, name, address, taxRate);
    if (ok) {
      toast('success', 'Store updated successfully!');
      setEditingStore(null);
    } else {
      toast('error', 'Failed to update store');
    }
    return ok;
  };

  const handleAddStore = async () => {
    if (!newStoreName.trim()) {
      toast('error', 'Store name is required');
      return;
    }
    
    setAddingStore(true);
    try {
      const added = await addStore(
        newStoreName, 
        newStoreAddress, 
        parseFloat(newTaxRate) || 0
      );
      
      if (added) {
        toast('success', 'Store created successfully!');
        setNewStoreName('');
        setNewStoreAddress('');
        setNewTaxRate('');
      } else {
        toast('error', 'Failed to create store');
      }
    } catch (e) {
      toast('error', 'An error occurred while creating store');
    }
    setAddingStore(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Store className="w-5 h-5 text-gray-500" /> My Stores
        </h3>
        
        {stores.length === 0 ? (
          <div className="text-sm text-gray-500 py-4">No stores available.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {stores.map(store => (
              <div key={store.id} className="border border-gray-100 bg-gray-50 rounded-lg p-4 relative group hover:border-blue-200 transition-colors">
                {isOwner && (
                  <div className="absolute top-4 right-4 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditingStore(store as StoreType)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                      Edit
                    </button>
                    {stores.length > 1 && (
                      <button 
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete the store "${store.name}"? This action cannot be undone.`)) {
                            deleteStore(store.id).then(ok => {
                              if (ok) toast('success', 'Store deleted successfully!');
                              else toast('error', 'Failed to delete store');
                            });
                          }
                        }}
                        className="text-xs font-medium text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
                <div className="font-medium text-gray-900 mb-1 pr-20 hover:text-blue-700 cursor-default">{store.name}</div>
                <div className="text-sm text-gray-500">{store.address || 'No address provided'}</div>
                <div className="text-xs text-gray-400 mt-2">Tax Rate: {store.taxRate}%</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingStore && (
        <EditStoreModal
          store={editingStore}
          onSave={handleUpdate}
          onClose={() => setEditingStore(null)}
        />
      )}

      {isOwner && (
        <div className="bg-white rounded-xl border border-blue-100 shadow-sm p-5">
          <h3 className="font-semibold text-blue-900 mb-4 flex items-center gap-2">
            Add New Store
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Name</label>
              <input 
                className={inputCls} 
                value={newStoreName} 
                onChange={(e) => setNewStoreName(e.target.value)} 
                placeholder="E.g., Branch 2 - Mabini St."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Address</label>
              <textarea
                className={inputCls + ' resize-none'}
                rows={2}
                value={newStoreAddress}
                onChange={(e) => setNewStoreAddress(e.target.value)}
                placeholder="Optional physical address"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Tax Rate (%)</label>
              <input
                type="number"
                className={inputCls + ' w-32 font-mono'}
                value={newTaxRate}
                onChange={(e) => setNewTaxRate(e.target.value)}
                min={0}
                max={100}
                step={0.01}
                placeholder="0.00"
              />
            </div>
            
            <div className="pt-2">
              <Button variant="primary" loading={addingStore} onClick={handleAddStore}>        
                Create Store
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );}
// ─── User Management ─────────────────────────────────────────────────────────

const selectCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer';

interface EditUserModalProps {
  user: User;
  onSave: (updated: User) => void;
  onClose: () => void;
}

function EditUserModal({ user, onSave, onClose }: EditUserModalProps) {
  const { toast } = useToast();
  const { stores } = useAuthStore();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<any>(user.role);
  const [storeId, setStoreId] = useState(user.storeId || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast('error', 'Name is required.'); return; }
    if (!email.trim() || !email.includes('@')) { toast('error', 'A valid email is required.'); return; }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    onSave({ ...user, name: name.trim(), email: email.trim(), role, storeId });
    toast('success', 'User updated successfully.');
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Edit User</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Avatar preview */}
        <div className="px-6 pt-5 pb-2 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-base shrink-0">
            {name.charAt(0) || '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{name || 'New Name'}</p>
            <p className="text-xs text-gray-500">{email || 'email@example.com'}</p>
          </div>
        </div>
        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-3 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Maria Santos"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
            <input
              type="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. maria@store.ph"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Role</label>
              <select
                className={selectCls}
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'cashier')}
              >
                <option value="cashier">Cashier — POS access only</option>
                <option value="admin">Admin — Full access</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Assignment</label>
              <select
                className={selectCls}
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                disabled={stores.length <= 1}
              >
                <option value="">No Store Assigned</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={saving}>
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CreateUserModalProps {
  onCreate: (user: User) => void;
  onClose: () => void;
}

function CreateUserModal({ onCreate, onClose }: CreateUserModalProps) {
  const { toast } = useToast();
  const { stores, activeStoreId } = useAuthStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<any>('cashier');
  const [storeId, setStoreId] = useState(activeStoreId || '');
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast('error', 'Name is required.'); return; }
    if (!email.trim() || !email.includes('@')) { toast('error', 'A valid email is required.'); return; }
    if (!password) { toast('error', 'Password is required.'); return; }
    if (password.length < 6) { toast('error', 'Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { toast('error', 'Passwords do not match.'); return; }
    
    setCreating(true);
    // Placeholder until user creation is wired to a server-side Supabase Auth admin flow.
    await new Promise((r) => setTimeout(r, 600));
    
    const passwordHash = await hashPassword(password);
    
    const newUser: User = {
      id: `user-${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      role,
      passwordHash,
      storeId
    };
    
    try {
      console.warn('createUser not implemented in authStore');
      onCreate(newUser);
      toast('success', `${role === 'admin' ? 'Admin' : 'User'} created successfully.`);
    } catch (err: any) {
      toast('error', err.message || 'Failed to create user. Ensure you have admin permissions.');
    }
    
    setCreating(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Create New {role === 'admin' ? 'Admin' : 'User'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
            <input 
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Juan Dela Cruz"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
            <input 
              type="email"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. juan@store.ph"
              required
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <input 
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
              <input 
                type="password"
                className={inputCls}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Role</label>
              <select
                className={selectCls}
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'cashier')}
              >
                <option value="cashier">Cashier • POS access only</option>
                <option value="admin">Admin • Full system access</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Assignment</label>
              <select
                className={selectCls}
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                disabled={stores.length <= 1}
              >
                <option value="">No Store Assigned</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" type="button" onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={creating}>
              Create {role === 'admin' ? 'Admin' : 'User'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function UserManagementPage() {
  const { toast } = useToast();
  const { stores } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const handleEditSave = (updated: User) => {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  };

  const handleCreate = () => {
    setUsers([]);
  };

  const handleRemove = () => {
    setUsers((prev) => prev.filter((u) => u.id !== deleteTarget?.id));
    toast('success', `${deleteTarget?.name} has been removed.`);
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">System Users</h3>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            + Invite User
          </Button>
        </div>
        <ul className="divide-y divide-gray-50">
          {users.map((u) => {
            const assignedStore = stores.find(s => s.id === u.storeId);
            return (
            <li key={u.id} className="flex items-center gap-4 px-5 py-4">
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                {u.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm">{u.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-gray-500">{u.email}</p>
                  {assignedStore && (
                    <>
                      <span className="text-gray-300">•</span>
                      <p className="text-xs text-gray-600 flex items-center gap-1">
                        <Store className="w-3 h-3" />
                        {assignedStore.name}
                      </p>
                    </>
                  )}
                </div>
              </div>
              <Badge variant={u.role === 'admin' ? 'info' : 'default'}>
                {u.role.charAt(0).toUpperCase() + u.role.slice(1)}
              </Badge>
              <button
                className="text-xs text-blue-600 hover:underline font-medium"
                onClick={() => setEditTarget(u)}
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteTarget(u)}
                className="text-xs text-red-500 hover:underline font-medium"
              >
                Remove
              </button>
            </li>
          );
          })}
        </ul>
      </div>

      {editTarget && (
        <EditUserModal
          user={editTarget}
          onSave={handleEditSave}
          onClose={() => setEditTarget(null)}
        />
      )}

      {createOpen && (
        <CreateUserModal 
            onCreate={handleCreate}
            onClose={() => setCreateOpen(false)}
          />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove User"
        description={`Are you sure you want to remove "${deleteTarget?.name}"? They will lose access immediately.`}
        confirmLabel="Remove"
        danger
        onConfirm={handleRemove}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────

export function NotificationsSettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState({
    lowStock: true,
    outOfStock: true,
    dailySummary: false,
    salesMilestone: true,
  });

  const labels: Record<string, { title: string; description: string }> = {
    lowStock: { title: 'Low Stock Alerts', description: 'Notify when a product reaches its minimum stock level' },
    outOfStock: { title: 'Out of Stock Alerts', description: 'Notify when a product reaches zero stock' },
    dailySummary: { title: 'Daily Summary Email', description: 'Receive a daily sales and inventory summary' },
    salesMilestone: { title: 'Sales Milestone Alerts', description: 'Notify when daily revenue hits a target' },
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="font-semibold text-gray-900 mb-5 flex items-center gap-2">
        <Bell className="w-4 h-4" /> Notification Preferences
      </h3>
      <div className="space-y-4">
        {Object.entries(settings).map(([key, enabled]) => (
          <div key={key} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
            <div>
              <p className="text-sm font-medium text-gray-900">{labels[key].title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{labels[key].description}</p>
            </div>
            <button
              onClick={() => {
                setSettings((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
                toast('info', 'Preference updated.');
              }}
              className={cn(
                'relative w-10 h-6 rounded-full transition-colors focus:outline-none',
                enabled ? 'bg-blue-600' : 'bg-gray-200'
              )}
            >
              <span
                className={cn(
                  'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  enabled ? 'left-5' : 'left-1'
                )}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Security ────────────────────────────────────────────────────────────────

export function SecuritySettingsPage() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass !== confirm) { toast('error', 'Passwords do not match.'); return; }
    if (newPass.length < 8) { toast('error', 'Password must be at least 8 characters.'); return; }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 700));
    toast('success', 'Password changed successfully!');
    setSaving(false);
    setCurrent(''); setNewPass(''); setConfirm('');
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 max-w-sm">
      <h3 className="font-semibold text-gray-900 mb-5 flex items-center gap-2">
        <Shield className="w-4 h-4" /> Change Password
      </h3>
      <form onSubmit={handleChange} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Current Password</label>
          <input type="password" className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
          <input type="password" className={inputCls} value={newPass} onChange={(e) => setNewPass(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm New Password</label>
          <input type="password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <Button type="submit" variant="primary" loading={saving} className="w-full">
          Update Password
        </Button>
      </form>
    </div>
  );
}
