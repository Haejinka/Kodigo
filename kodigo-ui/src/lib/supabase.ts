import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
}

export const SIGNUP_CONFIRMATION_PENDING_KEY = 'kodigo_signup_confirmation_pending';
export const SIGNUP_CONFIRMATION_NOTICE_KEY = 'kodigo_signup_confirmation_notice';

let signupConfirmationCallbackDetected = false;

export function consumeSignupConfirmationCallback() {
  const detected = signupConfirmationCallbackDetected;
  signupConfirmationCallbackDetected = false;
  return detected;
}

function shouldDetectSessionInUrl(url: URL, params: Record<string, string>) {
  const isSuccessfulSignupConfirmation =
    params.type === 'signup' && Boolean(params.access_token && params.refresh_token);

  if (isSuccessfulSignupConfirmation) {
    signupConfirmationCallbackDetected = true;

    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(SIGNUP_CONFIRMATION_PENDING_KEY, '1');
        window.sessionStorage.setItem(SIGNUP_CONFIRMATION_NOTICE_KEY, '1');

        // Email verification confirms the account, but this flow should wait for an explicit sign-in.
        const cleanUrl = new URL(url.href);
        cleanUrl.hash = '';
        for (const key of [
          'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type',
          'provider_token', 'provider_refresh_token', 'type',
        ]) {
          cleanUrl.searchParams.delete(key);
        }
        window.history.replaceState(window.history.state, '', cleanUrl.toString());
      } catch {
        // Keep the confirmation callback from creating a session even if browser storage is unavailable.
      }
    }

    return false;
  }

  return Boolean(params.access_token || params.error_description);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { detectSessionInUrl: shouldDetectSessionInUrl },
});
