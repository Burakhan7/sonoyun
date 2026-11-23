const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Loaded on demand, so visitors download nothing extra when error tracking is off.
if (dsn) {
  void import('@sentry/nextjs').then((Sentry) => {
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
  });
}
