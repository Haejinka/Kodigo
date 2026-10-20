import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { ShieldAlert, KeyRound, Copy, Check, ChevronDown, LogOut, Monitor, Moon, Shield, Sun } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useDisplayScaleStore, type DisplayScale } from '@/stores/displayScaleStore';
import { Button } from '@/components/shared/Button';
import { supabase } from '@/lib/supabase';

export function SuperAdminPage() {
  const { role, user, profile, logout } = useAuthStore();
  const navigate = useNavigate();
  const theme = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggleMode);
  const displayScale = useDisplayScaleStore((state) => state.scale);
  const setDisplayScale = useDisplayScaleStore((state) => state.setScale);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);      
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteCodes, setInviteCodes] = useState<any[]>([]);

  useEffect(() => {
    if (role === 'super_admin') {
      fetchCodes();
    }
  }, [role]);

  const fetchCodes = async () => {
    try {
      const { data, error } = await supabase
        .from('invite_codes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
         console.error("fetchCodes error: ", error);
         return;
      }
      
      if (data) {
         setInviteCodes(data);
      }
    } catch (err) {
      console.error("fetchCodes exception: ", err);
    }
  };

  // Security check: only allow Super Admins
  if (role !== 'super_admin') {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-[50vh]">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Access Denied</h2>
        <p className="text-gray-500 mt-2">You do not have permission to view this page.</p>
      </div>
    );
  }

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setGeneratedCode(null);
    setCopied(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Your session has expired. Sign in again.');

      const { data, error } = await supabase.functions.invoke('generate-invite', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) {
        console.error("Invite generation error:", error);
        let message = error.message || 'Failed to generate invite code';
        try {
          const body = await error.context?.json();
          if (body?.error) message = body.error;
        } catch {
          // The platform error text is still useful when the response has no JSON body.
        }
        throw new Error(message);
      }

      const inviteCode = data?.code;
      if (!inviteCode) throw new Error("Invite code was not returned by the server");

      setGeneratedCode(inviteCode); 
      await fetchCodes();
    } catch (err: any) {
      setError(err.message || 'Failed to generate code.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleLogout = async () => {
    setAccountMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  const displayName = profile?.name || user?.user_metadata?.name || user?.email || 'Super Admin';

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <img src="/kodigo-icon.png" alt="" className="h-8 w-8 rounded-md object-contain" />
            <div>
              <p className="font-semibold text-[var(--foreground)]">KodiGo</p>
              <p className="text-xs text-[var(--muted-foreground)]">Invite code portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
              aria-label={`Theme: ${theme}`}
              title={`Theme: ${theme}`}
            >
              {theme === 'dark' ? <Moon className="h-4 w-4 text-blue-400" /> : <Sun className="h-4 w-4 text-amber-500" />}
              <span className="hidden capitalize sm:inline">{theme}</span>
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                className="flex h-10 items-center gap-2 rounded-lg px-2 hover:bg-[var(--muted)]"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-label="Open account menu"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                  {displayName.charAt(0).toUpperCase()}
                </span>
                <span className="hidden max-w-40 truncate text-sm font-medium text-[var(--foreground)] sm:block">{displayName}</span>
                <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
              </button>
              {accountMenuOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-10 cursor-default"
                    aria-label="Close account menu"
                    onClick={() => setAccountMenuOpen(false)}
                  />
                  <div role="menu" className="absolute right-0 top-12 z-20 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl">
                    <div className="border-b border-[var(--border)] px-4 py-3">
                      <p className="truncate text-sm font-semibold text-[var(--foreground)]">{displayName}</p>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{user?.email}</p>
                      <p className="mt-1 text-xs capitalize text-[var(--muted-foreground)]">Super Admin</p>
                    </div>
                    <div className="border-b border-[var(--border)] px-4 py-3">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--muted-foreground)]">
                        <Monitor className="h-3.5 w-3.5" /> Screen size
                      </div>
                      <div className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--muted)] p-1" role="group" aria-label="Screen size">
                        {([
                          { value: 90, label: 'Compact' },
                          { value: 100, label: 'Default' },
                          { value: 110, label: 'Large' },
                        ] as const).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={displayScale === option.value}
                            onClick={() => setDisplayScale(option.value as DisplayScale)}
                            className={`rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors ${displayScale === option.value ? 'bg-[var(--card)] text-[var(--primary)] shadow-sm' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                          >
                            {option.label}
                            <span className="mt-0.5 block font-mono">{option.value}%</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigate('/account/security');
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                    >
                      <Shield className="h-4 w-4 text-[var(--muted-foreground)]" /> Account security
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleLogout()}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                    >
                      <LogOut className="h-4 w-4 text-[var(--muted-foreground)]" /> Log out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Super Admin Portal</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Generate and manage one-time invite codes for new store owners.</p>
      </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--primary-soft)]">
            <KeyRound className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Generate Invite Code</h2>
            <p className="text-sm text-[var(--muted-foreground)]">Create a secure, one-time-use code for a new store owner.</p>
          </div>
        </div>

        <div className="mt-4 border-t border-[var(--border)] py-4">
          <Button 
            onClick={handleGenerate} 
            loading={loading}
            variant="primary"
            className="w-full md:w-auto"
          >
            Generate New Code
          </Button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-[var(--destructive-border)] bg-[var(--destructive-soft)] p-3 text-sm text-[var(--destructive)]">
            {error}
          </div>
        )}

        {generatedCode && (
          <div className="mt-6 flex flex-col items-center rounded-xl border border-[var(--border)] bg-[var(--muted)] p-6">
            <p className="mb-2 text-sm font-medium uppercase tracking-wider text-[var(--muted-foreground)]">New Code Generated</p>
            <div className="flex w-full items-center justify-center space-x-3 rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--card)] px-6 py-4">
              <span className="text-2xl font-mono font-bold tracking-wider text-[var(--foreground)]">
                {generatedCode}
              </span>
              <button 
                onClick={() => copyToClipboard(generatedCode)}
                className="ml-4 rounded-lg p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
                title="Copy to clipboard"
                aria-label="Copy generated invite code"
              >
                {copied === generatedCode ? <Check className="w-6 h-6 text-green-600" /> : <Copy className="w-6 h-6" />}
              </button>
            </div>
            <p className="mt-4 text-center text-xs text-[var(--muted-foreground)]">
              Share this code securely with the client. It can only be used once.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)]">
        <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Your Generated Codes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--muted)] font-medium text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Used By</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {inviteCodes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--muted-foreground)]">No invite codes generated yet.</td>
                </tr>
              ) : (
                inviteCodes.map((invite) => (
                  <tr key={invite.id} className="hover:bg-[var(--muted)]/50">
                    <td className="px-4 py-3 font-mono font-medium text-[var(--foreground)]">
                      {invite.code}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {new Date(invite.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {invite.is_used ? (
                        <span className="inline-flex items-center rounded-full bg-[var(--destructive-soft)] px-2 py-1 text-xs font-medium text-[var(--destructive)]">
                          Used
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[var(--success-soft)] px-2 py-1 text-xs font-medium text-[var(--success-foreground)]">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">
                      {invite.is_used ? 'Account Created' : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {!invite.is_used && (
                        <button
                          onClick={() => copyToClipboard(invite.code)}
                          className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
                          title="Copy Code"
                          aria-label={`Copy invite code ${invite.code}`}
                        >
                          {copied === invite.code ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </main>
    </div>
  );
}
