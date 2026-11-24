'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { adminChatsResponseSchema, type AdminChatSummary, type AdminChatsResponse } from 'shared';
import { AdminNav, PartyAvatar, chatLabel, partyName, timeAgo, timeLeft } from './common';

const REFRESH_MS = 5_000;

function ChatCard({ chat, now }: { chat: AdminChatSummary; now: number }) {
  const [first, second] = chat.participants;
  const sender = chat.participants.find((party) => party.id === chat.preview?.senderId);
  const when = chat.lastMessageAt ?? chat.startedAt;

  return (
    <li>
      <Link
        href={`/admin/sohbet/${chat.kind}/${chat.id}`}
        className={`flex h-full flex-col gap-2 rounded-2xl border-2 bg-white p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:shadow-md ${
          chat.reported ? 'border-danger' : chat.live ? 'border-success/60' : 'border-ink/10'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          {chat.live && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-success">
              <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden />
              Canlı
            </span>
          )}
          <span className="rounded-full bg-ink/5 px-2 py-0.5">{chatLabel(chat)}</span>
          {chat.reported && (
            <span className="rounded-full bg-danger px-2 py-0.5 text-white">Raporlu</span>
          )}
          {chat.live && chat.endsAt && (
            <span className="ml-auto tabular-nums text-muted">
              {timeLeft(chat.endsAt, now)} kaldı
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex -space-x-3">
            <PartyAvatar party={first} />
            <PartyAvatar party={second} />
          </div>
          <p className="min-w-0 truncate text-sm font-bold">
            {partyName(first)} <span className="text-muted">↔</span> {partyName(second)}
          </p>
        </div>

        <p className="line-clamp-2 min-h-[2.5rem] break-words text-sm">
          {chat.preview ? (
            <>
              <strong>{partyName(sender)}:</strong> {chat.preview.body}
            </>
          ) : (
            <span className="text-muted">Henüz mesaj yok.</span>
          )}
        </p>

        <p className="mt-auto text-xs text-muted">
          {chat.messageCount} mesaj{when ? ` · ${timeAgo(when, now)}` : ''}
        </p>
      </Link>
    </li>
  );
}

function Section({
  title,
  empty,
  chats,
  now,
}: {
  title: string;
  empty: string;
  chats: AdminChatSummary[];
  now: number;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold">
        {title} <span className="text-muted">({chats.length})</span>
      </h2>
      {chats.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {chats.map((chat) => (
            <ChatCard key={`${chat.kind}-${chat.id}`} chat={chat} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function ChatsClient() {
  const [data, setData] = useState<AdminChatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/chats', { cache: 'no-store' });
      if (!response.ok) throw new Error('Load failed');
      setData(adminChatsResponseSchema.parse(await response.json()));
      setError(null);
    } catch {
      setError('Sohbetler yüklenemedi.');
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Sohbetler</h1>
        <AdminNav />
      </div>
      <p className="mt-1 text-xs text-muted">
        Her 5 saniyede yenilenir. Mesajlar 24 saat sonra silindiği için yalnızca son 24 saat
        görünür.
      </p>
      {error && (
        <p role="alert" className="mt-3 font-semibold text-danger">
          {error}
        </p>
      )}
      {!data && !error && <p className="mt-4 text-muted">Yükleniyor…</p>}
      {data && (
        <>
          <Section
            title="Şu an konuşanlar"
            empty="Şu an aktif bir sohbet yok."
            chats={data.active}
            now={now}
          />
          <Section
            title="Kayıtlı sohbetler"
            empty="Son 24 saatte kayıtlı sohbet yok."
            chats={data.stored}
            now={now}
          />
        </>
      )}
    </main>
  );
}
