import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('renders the optimized image inside a circle on the animal color', () => {
    const html = renderToStaticMarkup(<Avatar id="tilki" size={64} />);

    expect(html).toContain('rounded-full');
    expect(html).toContain('src="/avatars/tilki.webp"');
    expect(html).toContain('/avatars/tilki@2x.webp 2x');
    expect(html).toContain('background-color:#F7B9A0');
  });
});
