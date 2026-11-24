import { deviceHashSchema } from 'shared';
import { describe, expect, it } from 'vitest';
import { hashTraits } from './device';

describe('hashTraits', () => {
  it('produces a summary the server accepts', async () => {
    const hash = await hashTraits(['v1', 'Mozilla/5.0', 'tr-TR']);
    expect(deviceHashSchema.safeParse(hash).success).toBe(true);
  });

  it('is stable for the same traits and differs for others', async () => {
    const traits = ['v1', 'Mozilla/5.0', 'tr-TR', '390x844x24@3'];
    expect(await hashTraits(traits)).toBe(await hashTraits([...traits]));
    expect(await hashTraits(traits)).not.toBe(
      await hashTraits([...traits.slice(0, 3), '360x800x24@3']),
    );
  });

  it('does not let two traits blur into one', async () => {
    expect(await hashTraits(['ab', 'c'])).not.toBe(await hashTraits(['a', 'bc']));
  });
});
