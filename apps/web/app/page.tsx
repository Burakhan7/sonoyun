import Link from 'next/link';
import { CATEGORIES } from 'shared';
import { HomeHeader } from '@/components/HomeHeader';

const STEPS = [
  { title: 'Eşleş', text: 'Rastgele biriyle eşleş, kategori ve oyun sürpriz olsun.' },
  { title: 'Oyna', text: '1–3 dakikalık mini oyunda rakibinle yarış.' },
  { title: 'Sohbet et', text: 'Kartlarını seç, 7 dakika sohbet et, istersen arkadaş ol.' },
];

const LEGAL_LINKS = [
  { href: '/kullanim-kosullari', label: 'Kullanım Koşulları' },
  { href: '/gizlilik', label: 'Gizlilik' },
  { href: '/kvkk', label: 'KVKK' },
];

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-3">
      <HomeHeader />

      <main className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
        <span aria-hidden="true" className="text-6xl">
          🎲
        </span>
        <div>
          <h1 className="text-3xl font-bold">Önce oyun, sonra sohbet</h1>
          <p className="mt-2 text-muted">Yabancıyla buz, bir oyunda kırılır.</p>
        </div>
        <Link
          href="/play"
          className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-accent text-xl font-bold text-white shadow-md transition-transform active:scale-95"
        >
          Oyna
        </Link>
      </main>

      <section aria-labelledby="how-title" className="py-4">
        <h2 id="how-title" className="text-center text-lg font-bold">
          Nasıl çalışır?
        </h2>
        <ol className="mt-3 space-y-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-bold text-cream">
                {index + 1}
              </span>
              <span className="text-sm">
                <strong className="block">{step.title}</strong>
                <span className="text-muted">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <ul aria-hidden="true" className="flex flex-wrap justify-center gap-2 py-3 text-2xl">
        {CATEGORIES.map((category) => (
          <li key={category.id}>{category.emoji}</li>
        ))}
      </ul>

      <footer className="flex flex-wrap justify-center gap-x-1 text-xs text-muted">
        {LEGAL_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="flex min-h-touch items-center px-2">
            {link.label}
          </Link>
        ))}
      </footer>
    </div>
  );
}
