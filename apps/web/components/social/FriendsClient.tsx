'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { friendsResponseSchema, type Friend, type FriendsResponse } from 'shared';
import { z } from 'zod';
import { Avatar } from '@/components/Avatar';
import { PageHeader } from '@/components/PageHeader';
import { apiGet, apiPost } from '@/lib/api';
import { loadSession } from '@/lib/session';
import { connectSocket, type AppSocket } from '@/lib/socket';

const okSchema = z.object({ ok: z.literal(true) });

type Tab = 'friends' | 'incoming' | 'outgoing';

const PRESENCE_REFRESH_MS = 15_000;

const smallButton =
  'flex min-h-touch items-center justify-center rounded-lg px-2 text-xs font-semibold';

export function FriendsClient() {
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('friends');
  const [notice, setNotice] = useState<string | null>(null);
  const socketRef = useRef<AppSocket | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await apiGet('/api/friends', friendsResponseSchema));
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
        socketRef.current = socket;
        const update = () => void refresh();
        const onError = ({ message }: { message: string }) => setNotice(message);
        // Keeps the online dots current while the page stays open.
        const presenceTimer = window.setInterval(update, PRESENCE_REFRESH_MS);
        socket.on('friend:incoming', update);
        socket.on('friend:accepted', update);
        socket.on('moderation:result', update);
        socket.on('error', onError);
        detach = () => {
          window.clearInterval(presenceTimer);
          socket.off('friend:incoming', update);
          socket.off('friend:accepted', update);
          socket.off('moderation:result', update);
          socket.off('error', onError);
        };
        return refresh();
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      detach();
    };
  }, [refresh]);

  const removeFriend = async (friend: Friend) => {
    if (!window.confirm(`${friend.nickname} arkadaşlıktan çıkarılsın mı?`)) return;
    try {
      await apiPost(`/api/friends/${friend.id}/remove`, okSchema);
      await refresh();
    } catch {
      setNotice('İşlem yapılamadı, lütfen tekrar dene.');
    }
  };

  const blockFriend = (friend: Friend) => {
    if (!window.confirm(`${friend.nickname} engellensin mi? Arkadaşlığınız ve DM kapanır.`)) return;
    socketRef.current?.emit('user:block', { userId: friend.id });
  };

  const respond = (requestId: string, accept: boolean) => {
    socketRef.current?.emit('friend:respond', { requestId, accept });
    setData(
      (current) =>
        current && {
          ...current,
          incoming: current.incoming.filter((entry) => entry.requestId !== requestId),
        },
    );
    window.setTimeout(() => void refresh(), 400);
  };

  const cancelRequest = async (requestId: string) => {
    try {
      await apiPost(`/api/friends/requests/${requestId}/cancel`, okSchema);
      await refresh();
    } catch {
      setNotice('İşlem yapılamadı, lütfen tekrar dene.');
    }
  };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'friends', label: 'Arkadaşlar', count: data?.friends.length ?? 0 },
    { id: 'incoming', label: 'Gelen', count: data?.incoming.length ?? 0 },
    { id: 'outgoing', label: 'Giden', count: data?.outgoing.length ?? 0 },
  ];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
      <PageHeader title="Arkadaşlar" />

      <div role="tablist" className="grid grid-cols-3 gap-1 py-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`min-h-touch rounded-lg text-sm font-semibold ${
              tab === item.id ? 'bg-ink text-cream' : 'bg-ink/5'
            }`}
          >
            {item.label} ({item.count})
          </button>
        ))}
      </div>

      {notice && (
        <p role="alert" className="py-1 text-center text-xs font-semibold text-danger">
          {notice}
        </p>
      )}
      {failed && (
        <button type="button" onClick={refresh} className="min-h-touch text-sm underline">
          Yüklenemedi, tekrar dene
        </button>
      )}
      {!data && !failed && <p className="py-6 text-center text-muted">Yükleniyor…</p>}

      {data && tab === 'friends' && (
        <ul className="space-y-2 py-2">
          {data.friends.length === 0 && (
            <li className="py-6 text-center text-sm text-muted">
              Henüz arkadaşın yok. Bir oyun oyna, sohbetten sonra arkadaş ekle.
            </li>
          )}
          {data.friends.map((friend) => (
            <li key={friend.id} className="rounded-xl border border-ink/10 bg-white p-3">
              <div className="flex items-center gap-2">
                <Avatar id={friend.avatarId} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{friend.nickname}</p>
                  <p className="text-xs text-muted">
                    {friend.online ? '🟢 Çevrimiçi' : '⚪ Çevrimdışı'}
                  </p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                <Link
                  href={friend.conversationId ? `/messages/${friend.conversationId}` : '/messages'}
                  className={`${smallButton} bg-ink text-cream`}
                >
                  Mesaj
                </Link>
                <Link
                  href={`/play?invite=${friend.id}`}
                  className={`${smallButton} bg-accent text-center text-white`}
                >
                  Birlikte oyna
                </Link>
                <button
                  type="button"
                  onClick={() => removeFriend(friend)}
                  className={`${smallButton} bg-ink/5`}
                >
                  Çıkar
                </button>
                <button
                  type="button"
                  onClick={() => blockFriend(friend)}
                  className={`${smallButton} bg-ink/5 text-danger`}
                >
                  Engelle
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && tab === 'incoming' && (
        <ul className="space-y-2 py-2">
          {data.incoming.length === 0 && (
            <li className="py-6 text-center text-sm text-muted">Bekleyen istek yok.</li>
          )}
          {data.incoming.map(({ requestId, user }) => (
            <li
              key={requestId}
              className="flex items-center gap-2 rounded-xl border border-ink/10 bg-white p-3"
            >
              <Avatar id={user.avatarId} size={40} />
              <p className="min-w-0 flex-1 truncate font-semibold">{user.nickname}</p>
              <button
                type="button"
                onClick={() => respond(requestId, true)}
                className={`${smallButton} bg-accent text-white`}
              >
                Kabul et
              </button>
              <button
                type="button"
                onClick={() => respond(requestId, false)}
                className={`${smallButton} bg-ink/5`}
              >
                Reddet
              </button>
            </li>
          ))}
        </ul>
      )}

      {data && tab === 'outgoing' && (
        <ul className="space-y-2 py-2">
          {data.outgoing.length === 0 && (
            <li className="py-6 text-center text-sm text-muted">Gönderilmiş istek yok.</li>
          )}
          {data.outgoing.map(({ requestId, user }) => (
            <li
              key={requestId}
              className="flex items-center gap-2 rounded-xl border border-ink/10 bg-white p-3"
            >
              <Avatar id={user.avatarId} size={40} />
              <p className="min-w-0 flex-1 truncate font-semibold">{user.nickname}</p>
              <button
                type="button"
                onClick={() => cancelRequest(requestId)}
                className={`${smallButton} bg-ink/5`}
              >
                Geri çek
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
