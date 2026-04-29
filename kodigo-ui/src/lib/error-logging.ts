import { supabase } from '@/lib/supabase';

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return 'Unknown client error';
}

function errorStack(value: unknown) {
  return value instanceof Error ? value.stack ?? null : null;
}

export async function logClientError(input: {
  source: string;
  error: unknown;
  context?: Record<string, unknown>;
  storeId?: string | null;
}) {
  try {
    await supabase.rpc('log_client_error', {
      p_source: input.source,
      p_message: errorMessage(input.error),
      p_stack: errorStack(input.error),
      p_context: input.context ?? {},
      p_store_id: input.storeId ?? null,
    });
  } catch (loggingError) {
    console.warn('Failed to write client error log', loggingError);
  }
}

export function installGlobalErrorLogging(getStoreId: () => string | null | undefined) {
  const onError = (event: ErrorEvent) => {
    void logClientError({
      source: 'window.error',
      error: event.error ?? event.message,
      context: { filename: event.filename, lineno: event.lineno, colno: event.colno },
      storeId: getStoreId(),
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    void logClientError({
      source: 'window.unhandledrejection',
      error: event.reason,
      storeId: getStoreId(),
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}
