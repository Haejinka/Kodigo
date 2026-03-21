import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Settings, Users, Store, Bell, Shield, X, Mail,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { mockUsers } from '@/lib/mock-data';
import type { User } from '@/types';
import { Badge } from '@/components/shared/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/utils';

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

export function GeneralSettingsPage() {
  const { toast } = useToast();
  const [storeName, setStoreName] = useState('Aling Maria\'s Sari-Sari Store');
  const [storeAddress, setStoreAddress] = useState('123 Barangay Road, Barangay San Isidro');
  const [taxRate, setTaxRate] = useState('0');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 700));
    toast('success', 'Settings saved successfully!');
    setSaving(false);
  };

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Store className="w-4 h-4" /> Store Information
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Name</label>
            <input className={inputCls} value={storeName} onChange={(e) => setStoreName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Store Address</label>
            <textarea
              className={inputCls + ' resize-none'}
              rows={2}
              value={storeAddress}
              onChange={(e) => setStoreAddress(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Tax Rate (%)</label>
            <input
              type="number"
              className={inputCls + ' w-32 font-mono'}
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              min={0}
              max={100}
              step={0.01}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" loading={saving} onClick={handleSave}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}

// ─── User Management ─────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
const selectCls = inputCls + ' bg-white cursor-pointer';

interface EditUserModalProps {
  user: User;
  onSave: (updated: User) => void;
  onClose: () => void;
}

function EditUserModal({ user, onSave, onClose }: EditUserModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<'admin' | 'cashier'>(user.role);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast('error', 'Name is required.'); return; }
    if (!email.trim() || !email.includes('@')) { toast('error', 'A valid email is required.'); return; }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    onSave({ ...user, name: name.trim(), email: email.trim(), role });
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

interface InviteUserModalProps {
  onInvite: (user: User) => void;
  onClose: () => void;
}

function InviteUserModal({ onInvite, onClose }: InviteUserModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'cashier'>('cashier');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast('error', 'Name is required.'); return; }
    if (!email.trim() || !email.includes('@')) { toast('error', 'A valid email is required.'); return; }
    setSending(true);
    await new Promise((r) => setTimeout(r, 700));
    const newUser: User = {
      id: `user-${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      role,
    };
    onInvite(newUser);
    toast('success', `Invitation sent to ${email.trim()}.`);
    setSending(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Invite New User</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Info banner */}
        <div className="mx-6 mt-4 flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-lg px-3.5 py-2.5">
          <Mail className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700">An invitation email will be sent to the address below. The user can set their own password on first login.</p>
        </div>
        {/* Form */}
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
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={sending}>
              Send Invitation
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function UserManagementPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>(mockUsers);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const handleEditSave = (updated: User) => {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  };

  const handleInvite = (newUser: User) => {
    setUsers((prev) => [...prev, newUser]);
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
          <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
            + Invite User
          </Button>
        </div>
        <ul className="divide-y divide-gray-50">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-4 px-5 py-4">
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                {u.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm">{u.name}</p>
                <p className="text-xs text-gray-500">{u.email}</p>
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
          ))}
        </ul>
      </div>

      {editTarget && (
        <EditUserModal
          user={editTarget}
          onSave={handleEditSave}
          onClose={() => setEditTarget(null)}
        />
      )}

      {inviteOpen && (
        <InviteUserModal
          onInvite={handleInvite}
          onClose={() => setInviteOpen(false)}
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

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

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
