import type { ReactNode } from 'react';
import { PageHeader } from './PageHeader';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-10">
      <PageHeader title={title} />
      <p role="note" className="mt-3 rounded-lg bg-accent/10 p-3 text-sm font-semibold">
        Bu metin şablondur ve yayından önce hukukçu tarafından gözden geçirilecektir. Köşeli
        parantez içindeki alanlar doldurulmalıdır.
      </p>
      <div className="mt-4 space-y-4 text-sm leading-relaxed [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-bold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:font-semibold [&_a]:underline">
        {children}
      </div>
    </div>
  );
}
