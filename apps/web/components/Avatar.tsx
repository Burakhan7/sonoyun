'use client';

import { useState } from 'react';
import { getAvatar, type AvatarId } from 'shared';

interface AvatarProps {
  id: AvatarId;
  size?: number;
}

export function Avatar({ id, size = 48 }: AvatarProps) {
  const avatar = getAvatar(id);
  const [failedId, setFailedId] = useState<AvatarId | null>(null);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: avatar.background,
        fontSize: size * 0.55,
      }}
    >
      {/* The emoji sits under the image, so the circle is never empty while it loads or fails. */}
      <span role="img" aria-label={avatar.name}>
        {avatar.emoji}
      </span>
      {failedId !== id && (
        // A plain img keeps the pre-optimized 1x/2x webp files and reports load errors directly.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={id}
          src={`/avatars/${id}.webp`}
          srcSet={`/avatars/${id}.webp 1x, /avatars/${id}@2x.webp 2x`}
          alt=""
          width={size}
          height={size}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedId(id)}
        />
      )}
    </span>
  );
}
