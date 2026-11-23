'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { conversationsResponseSchema, type ConversationSummary } from 'shared';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { apiGet } from '@/lib/api';
import { loadSession } from '@/lib/session';
import { connectSocket } from '@/lib/socket';

export function MessagesClient() {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet('/api/conversations', conversationsResponseSchema);
      setConversations(data.conversations);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let detach = () => {};
    loadSession()
      .then(({ token }) => {
        if (cancelled) return;
        const socket = connectSocket(token);
        const update = () => void refresh();
        socket.on('dm:message', update);
        socket.on('friend:accepted', update);
        detach = () => {
          socket.off('dm:message', update);
          socket.off('friend:accepted', update);
        };
        return refresh();
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      detach();
    };
  }, [refresh]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
      <PageHeader title="Mesajlar" />
      <p className="py-2 text-center text-xs text-muted">⏳ Mesajlar 24 saat sonra kaybolur.</p>

      {failed && (
        <button type="button" onClick={refresh} className="min-h-touch text-sm underline">
          Yüklenemedi, tekrar dene
        </button>
      )}
      {!conversations && !failed && <p className="py-6 text-center text-muted">Yükleniyor…</p>}
      {conversations?.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">
          Henüz mesajın yok. Arkadaş olduğun kişilerle burada yazışabilirsin.
        </p>
      )}

      <ul className="space-y-2 pb-4">
        {conversations?.map(({ id, friend, lastMessage, unread }) => (
          <li key={id}>
            <Link
              href={`/messages/${id}`}
              className="flex min-h-touch items-center gap-2 rounded-xl border border-ink/10 bg-white p-3"
            >
              <Avatar id={friend.avatarId} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {friend.online ? '🟢 ' : '⚪ '}
                  {friend.nickname}
                </span>
                <span className="block truncate text-sm text-muted">
                  {lastMessage?.body ?? 'Henüz mesaj yok'}
                </span>
              </span>
              {unread > 0 && (
                <span
                  aria-label={`${unread} okunmamış mesaj`}
                  className="flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-white"
                >
                  {unread}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
