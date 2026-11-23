'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { serverEventSchemas, type ServerEventPayload } from 'shared';
import { hasStoredSession, loadSession } from '@/lib/session';
import { connectSocket, type AppSocket } from '@/lib/socket';

type Toast =
  | { kind: 'invite'; id: string; inviteId: string; text: string }
  | { kind: 'link'; id: string; text: string; href: string };

const TOAST_MS = 6_000;

/** While a game or chat is running, its screen must not be interrupted. */
const isPlayBusy = () => document.documentElement.dataset.playBusy === '1';

export function SocialToasts() {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const socketRef = useRef<AppSocket | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    // Visitors without an account stay disconnected until they open a page that needs one.
    if (!hasStoredSession()) return;
    let cancelled = false;
    let detach = () => {};

    loadSession()
      .then(({ token, user }) => {
        if (cancelled) return;
        const socket = connectSocket(token);
        socketRef.current = socket;

        const onInvite = (payload: ServerEventPayload<'invite:incoming'>) => {
          const parsed = serverEventSchemas['invite:incoming'].safeParse(payload);
          if (!parsed.success || isPlayBusy()) return;
          setToast({
            kind: 'invite',
            id: parsed.data.inviteId,
            inviteId: parsed.data.inviteId,
            text: `${parsed.data.from.nickname} seni oyuna davet ediyor`,
          });
        };
        const onInviteClosed = (payload: ServerEventPayload<'invite:closed'>) => {
          const parsed = serverEventSchemas['invite:closed'].safeParse(payload);
          if (!parsed.success) return;
          setToast((current) => (current?.id === parsed.data.inviteId ? null : current));
        };
        const onFriendRequest = (payload: ServerEventPayload<'friend:incoming'>) => {
          const parsed = serverEventSchemas['friend:incoming'].safeParse(payload);
          if (!parsed.success || pathRef.current === '/play' || pathRef.current === '/friends') {
            return;
          }
          setToast({
            kind: 'link',
            id: parsed.data.requestId,
            text: `${parsed.data.from.nickname} seni eklemek istiyor`,
            href: '/friends',
          });
        };
        const onDirectMessage = (payload: ServerEventPayload<'dm:message'>) => {
          const parsed = serverEventSchemas['dm:message'].safeParse(payload);
          if (!parsed.success || parsed.data.message.senderId === user.id) return;
          const href = `/messages/${parsed.data.conversationId}`;
          if (pathRef.current === href || pathRef.current === '/messages' || isPlayBusy()) return;
          setToast({ kind: 'link', id: parsed.data.message.id, text: '💬 Yeni mesajın var', href });
        };

        socket.on('invite:incoming', onInvite);
        socket.on('invite:closed', onInviteClosed);
        socket.on('friend:incoming', onFriendRequest);
        socket.on('dm:message', onDirectMessage);
        detach = () => {
          socket.off('invite:incoming', onInvite);
          socket.off('invite:closed', onInviteClosed);
          socket.off('friend:incoming', onFriendRequest);
          socket.off('dm:message', onDirectMessage);
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      detach();
    };
  }, []);

  useEffect(() => {
    if (!toast || toast.kind === 'invite') return;
    const timeout = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!toast) return null;

  return (
    <div role="status" className="fixed inset-x-0 top-2 z-40 flex justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-ink p-3 text-cream shadow-xl">
        <p className="text-sm font-semibold">{toast.text}</p>
        {toast.kind === 'invite' ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                socketRef.current?.emit('invite:respond', {
                  inviteId: toast.inviteId,
                  accept: false,
                });
                setToast(null);
              }}
              className="min-h-touch rounded-lg bg-cream/15 text-sm font-semibold"
            >
              Reddet
            </button>
            <button
              type="button"
              onClick={() => window.location.assign(`/play?acceptInvite=${toast.inviteId}`)}
              className="min-h-touch rounded-lg bg-accent text-sm font-semibold text-white"
            >
              Kabul et
            </button>
          </div>
        ) : (
          <Link
            href={toast.href}
            onClick={() => setToast(null)}
            className="mt-1 flex min-h-touch items-center text-sm underline"
          >
            Görüntüle
          </Link>
        )}
      </div>
    </div>
  );
}
