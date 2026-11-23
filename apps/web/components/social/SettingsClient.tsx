'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  guestResponseSchema,
  transferCodeResponseSchema,
  type PublicUser,
  type TransferCodeResponse,
} from 'shared';
import { z } from 'zod';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { ApiError, apiPost } from '@/lib/api';
import { adoptSession, loadSession, resetSession } from '@/lib/session';

const DELETE_WORD = 'SİL';
const okSchema = z.object({ ok: z.literal(true) });

function formatClock(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function SettingsClient() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [transfer, setTransfer] = useState<TransferCodeResponse | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [creating, setCreating] = useState(false);
  const [input, setInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadSession()
      .then((session) => setUser(session.user))
      .catch(() => setError('Sunucuya bağlanılamadı.'));
  }, []);

  useEffect(() => {
    if (!transfer) return;
    const expiresAt = new Date(transfer.expiresAt).getTime();
    const update = () => {
      const left = expiresAt - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) setTransfer(null);
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [transfer]);

  const showCode = async () => {
    setCreating(true);
    setError(null);
    try {
      setTransfer(await apiPost('/api/me/transfer-code', transferCodeResponseSchema));
    } catch {
      setError('Kod oluşturulamadı, lütfen tekrar dene.');
    } finally {
      setCreating(false);
    }
  };

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    setRedeeming(true);
    setError(null);
    try {
      const session = await apiPost('/api/transfer/redeem', guestResponseSchema, {
        code: input.trim(),
      });
      adoptSession(session);
      // A full reload reconnects every page and socket with the transferred account.
      window.location.assign('/');
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 429
          ? 'Çok fazla deneme yaptın, biraz sonra tekrar dene.'
          : 'Kod geçersiz, süresi dolmuş ya da daha önce kullanılmış.',
      );
      setRedeeming(false);
    }
  };

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (deleteText !== DELETE_WORD) return;
    setDeleting(true);
    setError(null);
    try {
      await apiPost('/api/me/delete', okSchema, { confirm: DELETE_WORD });
      resetSession();
      window.location.assign('/');
    } catch {
      setError('Hesap silinemedi, lütfen tekrar dene.');
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pb-6">
      <PageHeader title="Ayarlar" />

      {user && (
        <section className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white p-3">
          <Avatar id={user.avatarId} size={48} />
          <p className="min-w-0 truncate font-semibold">{user.nickname}</p>
        </section>
      )}

      {error && (
        <p role="alert" className="text-center text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <h2 className="font-bold">Hesabını başka cihaza taşı</h2>
        <p className="mt-1 text-sm text-muted">
          Kodu yeni cihazda gir. Kod 10 dakika geçerlidir ve tek kullanımlıktır. Kimseyle paylaşma.
        </p>
        {transfer ? (
          <div className="mt-3 text-center">
            <p data-testid="transfer-code" className="font-mono text-2xl font-bold tracking-widest">
              {transfer.code}
            </p>
            <p className="mt-1 text-sm text-muted">Kalan süre: {formatClock(remaining)}</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={showCode}
            disabled={creating}
            className="mt-3 min-h-touch w-full rounded-xl bg-ink px-4 font-semibold text-cream disabled:opacity-60"
          >
            Kodu göster
          </button>
        )}
      </section>

      <form onSubmit={redeem} className="rounded-xl border border-ink/10 bg-white p-4">
        <h2 className="font-bold">Kodu gir</h2>
        <p className="mt-1 text-sm text-muted">
          Başka cihazdaki hesabına geçersin. Bu cihazdaki misafir hesabından çıkılır.
        </p>
        <label className="mt-3 block">
          <span className="sr-only">Taşıma kodu</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value.toUpperCase())}
            maxLength={16}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="K7Q2-M9XA"
            className="h-11 w-full rounded-xl border-2 border-ink/20 px-3 text-center font-mono text-lg uppercase outline-none focus:border-ink"
          />
        </label>
        <button
          type="submit"
          disabled={redeeming || input.trim().length < 8}
          className="mt-2 min-h-touch w-full rounded-xl bg-accent px-4 font-semibold text-white disabled:opacity-50"
        >
          Hesaba geç
        </button>
      </form>

      <form onSubmit={deleteAccount} className="rounded-xl border-2 border-danger/40 bg-white p-4">
        <h2 className="font-bold text-danger">Hesabımı sil</h2>
        <p className="mt-1 text-sm text-muted">
          Hesabın, arkadaşlıkların ve özel mesajların kalıcı olarak silinir. Bu işlem geri alınamaz.
          Yasal bağlantı kayıtları ve rapor kayıtları{' '}
          <Link href="/gizlilik" className="underline">
            Gizlilik Politikası
          </Link>
          ’ndaki süre boyunca saklanır.
        </p>
        <label className="mt-3 block text-sm font-semibold">
          Onaylamak için {DELETE_WORD} yaz
          <input
            value={deleteText}
            onChange={(event) => setDeleteText(event.target.value.toLocaleUpperCase('tr-TR'))}
            autoComplete="off"
            className="mt-1 h-11 w-full rounded-xl border-2 border-ink/20 px-3 text-center font-semibold outline-none focus:border-danger"
          />
        </label>
        <button
          type="submit"
          disabled={deleting || deleteText !== DELETE_WORD}
          className="mt-2 min-h-touch w-full rounded-xl bg-danger px-4 font-semibold text-white disabled:opacity-50"
        >
          Hesabımı kalıcı olarak sil
        </button>
      </form>
    </div>
  );
}
