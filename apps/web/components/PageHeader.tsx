import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  backHref = '/',
  children,
}: {
  title: ReactNode;
  backHref?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-2 border-b border-ink/10 py-2">
      <Link
        href={backHref}
        aria-label="Geri"
        className="flex min-h-touch min-w-touch items-center justify-center rounded-full text-xl"
      >
        ←
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
      {children}
    </header>
  );
}
