'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const CONSENT_KEY = 'analytics_consent';
const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

function readConsent() {
  try {
    return window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function saveConsent(value: 'granted' | 'denied') {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Without storage the banner simply asks again on the next visit.
  }
}

function loadAnalytics() {
  if (!domain || document.querySelector('script[data-analytics]')) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://plausible.io/js/script.js';
  script.dataset.domain = domain;
  script.dataset.analytics = 'true';
  document.head.appendChild(script);
}

/** Analytics load only after explicit consent, and only when a provider is configured. */
export function AnalyticsConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!domain) return;
    const consent = readConsent();
    if (consent === 'granted') loadAnalytics();
    else if (consent === null) setVisible(true);
  }, []);

  if (!visible) return null;

  const decide = (value: 'granted' | 'denied') => {
    saveConsent(value);
    if (value === 'granted') loadAnalytics();
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Çerez tercihi"
      className="fixed inset-x-0 bottom-0 z-30 flex justify-center p-3"
    >
      <div className="w-full max-w-md rounded-2xl bg-ink p-3 text-sm text-cream shadow-xl">
        <p>
          Siteyi geliştirmek için isteğe bağlı analitik kullanıyoruz.{' '}
          <Link href="/gizlilik" className="underline">
            Ayrıntılar
          </Link>
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => decide('denied')}
            className="min-h-touch rounded-lg bg-cream font-semibold text-ink"
          >
            Reddet
          </button>
          <button
            type="button"
            onClick={() => decide('granted')}
            className="min-h-touch rounded-lg bg-cream font-semibold text-ink"
          >
            Kabul et
          </button>
        </div>
      </div>
    </div>
  );
}
