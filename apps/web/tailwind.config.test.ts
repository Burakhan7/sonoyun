import { describe, expect, it } from 'vitest';
import config from './tailwind.config';

describe('tailwind theme', () => {
  it('defines the cream theme token from AGENTS.md', () => {
    expect(config.theme.extend.colors.cream).toBe('#F8F6F1');
  });
});
