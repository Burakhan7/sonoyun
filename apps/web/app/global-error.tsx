'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 16,
          textAlign: 'center',
          background: '#F8F6F1',
          color: '#23201B',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 24, margin: 0 }}>Bir sorun oluştu</h1>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: 44,
            padding: '0 20px',
            border: 0,
            borderRadius: 12,
            background: '#C2410C',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          Tekrar dene
        </button>
      </body>
    </html>
  );
}
