import { decodeJwt } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTokenService } from './auth.js';

describe('createTokenService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the lifetime at exactly 365 days across a second boundary', async () => {
    const RealDate = Date;
    let readings = 0;
    // Every clock reading lands one second later than the previous one.
    class SteppingDate extends RealDate {
      constructor(value?: number | string | Date) {
        if (value === undefined) super(1_700_000_000_000 + 1000 * readings++);
        else super(value);
      }
      static override now() {
        return 1_700_000_000_000 + 1000 * readings++;
      }
    }
    vi.stubGlobal('Date', SteppingDate);

    const token = await createTokenService('x'.repeat(32)).sign('user');
    vi.unstubAllGlobals();

    const { iat, exp } = decodeJwt(token);
    expect(exp! - iat!).toBe(365 * 24 * 60 * 60);
  });
});
