// Only coarse browser traits are used. Nothing is stored on the device, and the server only sees a hash.
const VERSION = 'v1';

function webglRenderer(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

/** Traits that stay the same in a private window of the same browser. */
export function deviceTraits(): string[] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  // Sorted so that rotating a phone does not change the result.
  const [short, long] = [screen.width, screen.height].sort((a, b) => a - b);
  return [
    VERSION,
    nav.userAgent,
    nav.languages?.join(',') ?? nav.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    `${short}x${long}x${screen.colorDepth}@${window.devicePixelRatio}`,
    String(nav.hardwareConcurrency ?? ''),
    String(nav.deviceMemory ?? ''),
    String(nav.maxTouchPoints ?? ''),
    webglRenderer(),
  ];
}

export async function hashTraits(traits: string[]): Promise<string> {
  const data = new TextEncoder().encode(traits.join('\u0000'));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest.subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

let pending: Promise<string | undefined> | null = null;

/** Resolves to undefined when the browser cannot hash, so the server falls back to the IP rule. */
export function deviceHash(): Promise<string | undefined> {
  pending ??= (async () => {
    try {
      if (!globalThis.crypto?.subtle) return undefined;
      return await hashTraits(deviceTraits());
    } catch {
      return undefined;
    }
  })();
  return pending;
}
