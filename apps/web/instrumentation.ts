const dsn = process.env.SENTRY_DSN;

// Error reports never include request data, user identity or chat content.
export async function register() {
  if (!dsn || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.breadcrumbs;
      return event;
    },
  });
}

export async function onRequestError(...args: unknown[]) {
  if (!dsn || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { captureRequestError } = await import('@sentry/nextjs');
  (captureRequestError as (...params: unknown[]) => void)(...args);
}
