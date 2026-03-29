import { useState, useEffect } from 'react';

import { ShieldAlert, KeyRound, Copy, Check, Clock, User, UserCheck } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/shared/Button';
import { supabase } from '@/lib/supabase';

export function SuperAdminPage() {
  const { role } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);      
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteCodes, setInviteCodes] = useState<any[]>([]);

  useEffect(() => {
    if (role === 'super_admin' as any) {
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
  if (role !== 'super_admin' as any) {
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
      // Create code on the frontend instead of relying on Edge Function
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");

      const inviteCode = `VIP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      const { data, error } = await supabase
        .from('invite_codes')
        .insert([{ 
          code: inviteCode, 
          role: 'admin',
          created_by: session.user.id 
        }])
        .select()
        .single();
        
      if (error) {
        console.error("Insert error:", error);
        throw new Error(error.message || "Failed to insert code into database");
      }

      setGeneratedCode(inviteCode); 
      fetchCodes();
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

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Super Admin Portal</h1>
        <p className="text-gray-500 text-sm mt-1">Manage system-wide settings and onboard new clients.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-purple-700" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Generate Invite Code</h2>
            <p className="text-sm text-gray-500">Create a secure, one-time-use code for a new store owner.</p>
          </div>
        </div>

        <div className="py-4 border-t border-gray-100 mt-4">
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
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        {generatedCode && (
          <div className="mt-6 p-6 bg-gray-50 border border-gray-200 rounded-xl flex flex-col items-center">
            <p className="text-sm text-gray-500 mb-2 font-medium uppercase tracking-wider">New Code Generated</p>
            <div className="flex items-center space-x-3 bg-white border-2 border-dashed border-gray-300 px-6 py-4 rounded-lg w-full justify-center">
              <span className="text-2xl font-mono font-bold text-gray-900 tracking-wider">
                {generatedCode}
              </span>
              <button 
                onClick={() => copyToClipboard(generatedCode)}
                className="ml-4 p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Copy to clipboard"
              >
                {copied === generatedCode ? <Check className="w-6 h-6 text-green-600" /> : <Copy className="w-6 h-6" />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-4 text-center">
              Share this code securely with the client. It can only be used once.
            </p>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Generated Codes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Used By</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {inviteCodes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">No invite codes generated yet.</td>
                </tr>
              ) : (
                inviteCodes.map((invite) => (
                  <tr key={invite.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">
                      {invite.code}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(invite.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {invite.is_used ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          Used
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {invite.is_used ? 'Account Created' : '-'}
                    </td>
                    <td className="px-4 py-3">
                      {!invite.is_used && (
                        <button
                          onClick={() => copyToClipboard(invite.code)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                          title="Copy Code"
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
    </div>
  );
}
