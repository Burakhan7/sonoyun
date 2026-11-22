import Link from 'next/link';

export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted">{text}</p>
      <Link href="/" className="flex min-h-touch items-center px-4 font-semibold underline">
        Ana sayfaya dön
      </Link>
    </main>
  );
}
