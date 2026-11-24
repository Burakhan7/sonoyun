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

/** Source port set by the trusted proxy (Caddy overwrites it), or null when it is absent. */
export function proxiedPort(header: string | string[] | undefined): number | null {
  const value = Number(Array.isArray(header) ? header.at(-1) : header);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : null;
}

function normalizeIp(ip: string) {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
