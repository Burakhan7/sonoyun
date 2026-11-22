import { CATEGORIES } from 'shared';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-bold">Önce oyun, sonra sohbet</h1>
      <p className="text-muted">Rastgele biriyle kısa bir oyun oyna, sonra 7 dakika sohbet et.</p>
      <ul aria-hidden="true" className="flex flex-wrap justify-center gap-2 text-2xl">
        {CATEGORIES.map((category) => (
          <li key={category.id}>{category.emoji}</li>
        ))}
      </ul>
    </main>
  );
}
