import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

// Error reports never include request data, user identity or chat content.
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.breadcrumbs;
      return event;
    },
  });
}

export function captureError(error: unknown) {
  if (dsn) Sentry.captureException(error);
}

export function flushErrors() {
  return dsn ? Sentry.flush(2_000) : Promise.resolve(true);
}
