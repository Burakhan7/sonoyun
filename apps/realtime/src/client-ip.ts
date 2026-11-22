interface HandshakeAddress {
  address: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Behind a trusted proxy the last X-Forwarded-For entry is the one that proxy added;
 * earlier entries are client-controlled and must not be used.
 */
export function clientIp({ address, headers }: HandshakeAddress, trustProxy: boolean): string {
  if (trustProxy) {
    const header = headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header.join(',') : header;
    const last = value
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1);
    if (last) return normalizeIp(last);
  }
  return normalizeIp(address);
}

function normalizeIp(ip: string) {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
