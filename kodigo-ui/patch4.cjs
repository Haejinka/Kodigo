const fs = require('fs');
let code = fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8');

const newModal = `interface CreateUserModalProps {
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
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast('error', 'Name is required.'); return; }
    if (!email.trim() || !email.includes('@')) { toast('error', 'A valid email is required.'); return; }
    if (!password) { toast('error', 'Password is required.'); return; }
    if (password.length < 6) { toast('error', 'Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { toast('error', 'Passwords do not match.'); return; }
    
    setCreating(true);
    // Simulate API call delay
    await new Promise((r) => setTimeout(r, 600));
    
    const passwordHash = await hashPassword(password);
    
    const newUser: User = {
      id: \`user-\${Date.now()}\`,
      name: name.trim(),
      email: email.trim(),
      role,
      passwordHash
    };
    
    try {
      useAuthStore.getState().createUser(newUser);
      onCreate(newUser);
      toast('success', \`\${role === 'admin' ? 'Admin' : 'User'} created successfully.\`);
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
}`;

let inviteStartStr = 'interface InviteUserModalProps {\r\n';
let inviteStart = code.indexOf(inviteStartStr);
if (inviteStart === -1) {
    inviteStartStr = 'interface InviteUserModalProps {\n';
    inviteStart = code.indexOf(inviteStartStr);
}

// Find the end of function InviteUserModal
const funcDef = "function InviteUserModal";
const funcDefIndex = code.indexOf(funcDef, inviteStart);
// Now find the end of its block by tracing braces? Too hard.
// Let's just find the first character of the next component. Currently it's `function SettingsContent()`? Wait, let's look at the file.
// Or we can just use REGEX!
// Match interface InviteUserModalProps ... down to `  );\r?\n}` where the next thing is probably empty line or `//` or `export`
code = code.replace(/interface InviteUserModalProps \{[\s\S]*?function InviteUserModal[\s\S]*?  \);\r?\n\}/, newModal);


// Also replace InviteUserModal usage
code = code.replace(/const \[inviteOpen, setInviteOpen\] = useState\(false\);/, "const [createOpen, setCreateOpen] = useState(false);");
code = code.replace(/const handleInvite = \(user: User\) => {/, "const handleCreate = (user: User) => {");
code = code.replace(/setUsers\(\[\.\.\.users, user\]\);/g, "setUsers(useAuthStore.getState().getUsers());");

code = code.split('{inviteOpen && (').join('{createOpen && (');
code = code.replace(/<InviteUserModal[\s\S]*?\/>/, `<CreateUserModal 
            onCreate={handleCreate}
            onClose={() => setCreateOpen(false)}
          />`);

code = code.replace(/onClick=\{\(\) => setInviteOpen\(true\)\}/g, "onClick={() => setCreateOpen(true)}");
code = code.replace(/<UserPlus className="w-4 h-4 ml-1" \/> Invite User/g, `<UserPlus className="w-4 h-4 ml-1" /> Create User`);


// also inject imports
if (!code.includes('useAuthStore')) {
  code = code.replace("import { cn } from '@/lib/utils';", "import { cn, hashPassword } from '@/lib/utils';\nimport { useAuthStore } from '@/stores/authStore';");
}

fs.writeFileSync('src/pages/SettingsPage.tsx', code);
console.log("Successfully patched SettingsPage.tsx");
