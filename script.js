const fs = require('fs');
let content = fs.readFileSync('kodigo-ui/src/pages/SettingsPage.tsx', 'utf8');

// Replace mockUsers import out
content = content.replace(/import { mockUsers } from '@\/lib\/mock-data';\r?\n/, '');

// Replace InviteUserModalProps definition and InviteUserModal function
const replaceStart = content.indexOf('interface InviteUserModalProps {');
const replaceEnd = content.indexOf('export function UserManagementPage() {');
if (replaceStart > -1 && replaceEnd > -1) {
  content = content.substring(0, replaceStart) + 
\interface CreateUserModalProps {
  onCreate: (user: User) => void;
  onClose: () => void;
}

function CreateUserModal({ onCreate, onClose }: CreateUserModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'cashier'>('cashier');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast('error', 'Name is required.'); return; }
    if (!email.trim() || !email.includes('@')) { toast('error', 'A valid email is required.'); return; }
    if (!password) { toast('error', 'Password is required.'); return; }
    if (password.length < 6) { toast('error', 'Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { toast('error', 'Passwords do not match.'); return; }

    setSaving(true);
    await new Promise((r) => setTimeout(r, 700));

    // Hash password for secure mock storage
    const passwordHash = await hashPassword(password);

    const newUser: User = {
      id: \\\user-\\\\,
      name: name.trim(),
      email: email.trim(),
      role,
      passwordHash,
    };
    
    try {
      useAuthStore.getState().createUser(newUser);
      onCreate(newUser);
      toast('success', \\\\ created successfully.\\\);
    } catch (err) {
      toast('error', 'Failed to create user. Ensure you have admin permissions.');
    }
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">   
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />        
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Create New {role === 'admin' ? 'Admin' : 'User'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Info banner */}
        {role === 'admin' && (
          <div className="mx-6 mt-4 flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
            <Shield className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700">Warning: Admins have full access to the system. Assign this role carefully.</p>   
          </div>
        )}
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Role</label>
            <select
              className={selectCls}
              value={role}
              onChange={(e) => setRole(e.target.value)}  
            >
              <option value="cashier">Cashier</option>      
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={saving}>
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

\ + content.substring(replaceEnd);
}

// Replace UserManagementPage internals to use createOpen instead of inviteOpen, use users from store
content = content.replace(/const \[users, setUsers\] = useState<User\[\]>\(mockUsers\);/, 
  \const [users, setUsers] = useState<User[]>([]);\\n  useEffect(() => { setUsers(useAuthStore.getState().getUsers()); }, []);\);

content = content.replace(/const \[inviteOpen, setInviteOpen\] = useState\(false\);/, 
  \const [createOpen, setCreateOpen] = useState(false);\);

content = content.replace(/const handleInvite = \(newUser: User\) => \{\r?\n\s*setUsers\(\(prev\) => \[\.\.\.prev, newUser\]\);\r?\n\s*\};\r?\n/m, 
  \const handleCreate = () => {\\n    setUsers([...useAuthStore.getState().getUsers()]);\\n  };\\n\);

content = content.replace(/<Button variant="primary" size="sm" onClick=\{\(\) => setInviteOpen\(true\)\}>[\s\S]*?<\/Button>/, 
  \<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            + Add User
          </Button>\);

content = content.replace(/\{inviteOpen && \([\s\S]*?<InviteUserModal[\s\S]*?onClose=\{\(\) => setInviteOpen\(false\)\}[\s\S]*?\/>\s*\)\}/m, 
  \{createOpen && (
        <CreateUserModal
          onCreate={handleCreate}
          onClose={() => setCreateOpen(false)}
        />
      )}\);

fs.writeFileSync('kodigo-ui/src/pages/SettingsPage.tsx', content);
