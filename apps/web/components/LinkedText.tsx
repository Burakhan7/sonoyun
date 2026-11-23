'use client';

import { useState } from 'react';
import { splitLinks } from '@/lib/links';

export function LinkedText({ text }: { text: string }) {
  const [pending, setPending] = useState<{ href: string; host: string } | null>(null);

  return (
    <>
      {splitLinks(text).map((part, index) =>
        part.type === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="break-all underline"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setPending({ href: part.href, host: part.host });
            }}
          >
            {part.text}
          </a>
        ),
      )}
      {pending && (
        <span
          role="dialog"
          aria-modal="true"
          aria-label="Siteden ayrılıyorsun"
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="block w-full max-w-sm rounded-2xl bg-cream p-4 text-left text-ink shadow-xl">
            <strong className="block text-lg">Siteden ayrılıyorsun</strong>
            <span className="mt-1 block break-all text-sm text-muted">{pending.host}</span>
            <span className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="min-h-touch rounded-xl border-2 border-ink font-semibold"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => {
                  window.open(pending.href, '_blank', 'noopener,noreferrer');
                  setPending(null);
                }}
                className="min-h-touch rounded-xl bg-accent font-semibold text-white"
              >
                Devam et
              </button>
            </span>
          </span>
        </span>
      )}
    </>
  );
}
