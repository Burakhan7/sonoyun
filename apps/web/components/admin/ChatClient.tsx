'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminChatDetailSchema, type AdminChatDetail, type AdminChatKind } from 'shared';
import {
  AdminNav,
  BAN_OPTIONS,
  PartyAvatar,
  button,
  chatLabel,
  formatDate,
  formatTime,
  partyName,
  post,
  timeLeft,
} from './common';

const LIVE_REFRESH_MS = 3_000;
const STORED_REFRESH_MS = 15_000;

type Party = AdminChatDetail['chat']['participants'][number];

function PartyControls({
  party,
  onChanged,
  onError,
}: {
  party: Party;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch {
      onError('İşlem başarısız oldu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-2">
      <PartyAvatar party={party} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{partyName(party)}</p>
        {party.bannedUntil && (
          <p className="text-xs font-semibold text-danger">
            Banlı: {formatDate(party.bannedUntil)}
          </p>
        )}
      </div>
      {party.nickname !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <label>
            <span className="sr-only">{partyName(party)} için ban süresi</span>
            <select
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              className="min-h-touch rounded-lg border-2 border-ink/20 bg-white px-2 text-sm"
            >
              {BAN_OPTIONS.map((option) => (
                <option key={option.hours} value={option.hours}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => post(`users/${party.id}/ban`, { hours }))}
            className={`${button} bg-danger text-white`}
          >
            Banla
          </button>
          {party.bannedUntil && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => post(`users/${party.id}/unban`))}
              className={`${button} bg-ink/5`}
            >
              Kısıtları kaldır
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function ChatClient({ kind, id }: { kind: AdminChatKind; id: string }) {
  const [detail, setDetail] = useState<AdminChatDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/chats/${kind}/${id}`, { cache: 'no-store' });
      if (response.status === 404) return setStatus('missing');
      if (!response.ok) throw new Error('Load failed');
      setDetail(adminChatDetailSchema.parse(await response.json()));
      setStatus('ready');
    } catch {
      setStatus((current) => (current === 'ready' ? current : 'failed'));
    }
  }, [kind, id]);

  const live = detail?.chat.live ?? false;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = setInterval(() => void load(), live ? LIVE_REFRESH_MS : STORED_REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load, live]);

  // Follows new messages unless the moderator scrolled up to read older ones.
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [detail?.messages.length]);

  const chat = detail?.chat;
  const sides = new Map(chat?.participants.map((party, index) => [party.id, index]));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin" className={`${button} inline-flex items-center bg-ink/5`}>
          ← Sohbetler
        </Link>
        <AdminNav />
      </div>

      {status === 'loading' && <p className="mt-4 text-muted">Yükleniyor…</p>}
      {status === 'missing' && (
        <p className="mt-4 text-muted">Bu sohbet bulunamadı ya da mesajlarının süresi doldu.</p>
      )}
      {status === 'failed' && (
        <p role="alert" className="mt-4 font-semibold text-danger">
          Sohbet yüklenemedi.
        </p>
      )}

      {chat && detail && (
        <>
          <header className="mt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              {chat.live && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-success">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden />
                  Canlı
                </span>
              )}
              <span className="rounded-full bg-ink/5 px-2 py-0.5">{chatLabel(chat)}</span>
              {chat.reported && (
                <span className="rounded-full bg-danger px-2 py-0.5 text-white">
                  Açık rapor var
                </span>
              )}
              {chat.live && chat.endsAt && (
                <span className="tabular-nums text-muted">{timeLeft(chat.endsAt, now)} kaldı</span>
              )}
              {chat.startedAt && (
                <span className="text-muted">Başlangıç: {formatDate(chat.startedAt)}</span>
              )}
            </div>
            <ul className="mt-3 space-y-2">
              {chat.participants.map((party) => (
                <PartyControls key={party.id} party={party} onChanged={load} onError={setNotice} />
              ))}
            </ul>
            {notice && (
              <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                {notice}
              </p>
            )}
          </header>

          <ol
            ref={listRef}
            onScroll={(event) => {
              const list = event.currentTarget;
              stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
            }}
            aria-label="Mesajlar"
            aria-live={chat.live ? 'polite' : undefined}
            className="mt-4 flex max-h-[65dvh] min-h-[200px] flex-1 flex-col gap-2 overflow-y-auto rounded-2xl bg-ink/5 p-3"
          >
            {detail.messages.length === 0 && (
              <li className="m-auto text-sm text-muted">Henüz mesaj yok.</li>
            )}
            {detail.messages.map((message) => {
              const side = sides.get(message.senderId) ?? 0;
              const sender = chat.participants[side];
              return (
                <li
                  key={message.id}
                  className={`flex max-w-[85%] flex-col ${side === 1 ? 'items-end self-end' : 'items-start self-start'}`}
                >
                  <span className="text-xs font-semibold text-muted">
                    {partyName(sender)} · {formatTime(message.at)}
                  </span>
                  <p
                    className={`mt-0.5 whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                      side === 1 ? 'bg-accent text-white' : 'bg-white'
                    }`}
                  >
                    {message.body}
                  </p>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-muted">
            {detail.messages.length} mesaj ·{' '}
            {chat.live ? '3 saniyede bir yenilenir' : '15 saniyede bir yenilenir'}
          </p>
        </>
      )}
    </main>
  );
}
