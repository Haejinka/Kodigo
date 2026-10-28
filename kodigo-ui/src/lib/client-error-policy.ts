const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/;

/** Keep local Vite errors out of the shared production error feed. */
export function shouldReportClientError(
  isDevelopmentBuild: boolean,
  hostname: string | null | undefined,
): boolean {
  if (isDevelopmentBuild || !hostname) return false;

  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLocalHost = normalizedHostname === 'localhost'
    || normalizedHostname.endsWith('.localhost')
    || normalizedHostname === '::1'
    || LOOPBACK_IPV4.test(normalizedHostname);

  return !isLocalHost;
}
