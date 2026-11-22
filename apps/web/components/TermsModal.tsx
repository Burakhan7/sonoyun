import Link from 'next/link';

interface TermsModalProps {
  busy: boolean;
  failed: boolean;
  onAccept: () => void;
}

const RULES = [
  '18 yaşından küçükler bu siteyi kullanamaz.',
  'Saygılı ol: taciz, küfür ve nefret söylemi yasaktır.',
  'Rastgele sohbette link veya iletişim bilgisi paylaşma.',
];

export function TermsModal({ busy, failed, onAccept }: TermsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-title"
        className="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl bg-cream p-5 shadow-xl"
      >
        <h2 id="terms-title" className="text-xl font-bold">
          Başlamadan önce
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          Devam ederek{' '}
          <Link href="/kullanim-kosullari" className="underline">
            Kullanım Koşulları
          </Link>
          &apos;nı kabul etmiş olursun.{' '}
          <Link href="/kvkk" className="underline">
            KVKK Aydınlatma Metni
          </Link>
        </p>
        {failed && (
          <p role="alert" className="mt-3 text-sm text-accent">
            Onay kaydedilemedi. Lütfen tekrar dene.
          </p>
        )}
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={onAccept}
          className="mt-4 min-h-touch w-full rounded-xl bg-ink px-4 py-3 font-semibold text-cream disabled:opacity-60"
        >
          {busy ? 'Kaydediliyor…' : '18 yaşından büyüğüm, kabul ediyorum'}
        </button>
      </div>
    </div>
  );
}
