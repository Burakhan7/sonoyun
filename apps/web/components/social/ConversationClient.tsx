'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CATEGORIES,
  SOCKET_ERROR_CODES,
  messagesPageSchema,
  serverEventSchemas,
  type DirectMessage,
  type MessagesPage,
  type ServerEventPayload,
} from 'shared';
import { Avatar } from '@/components/Avatar';
import { LinkedText } from '@/components/LinkedText';
import { PageHeader } from '@/components/PageHeader';
import { ApiError, apiGet } from '@/lib/api';
import { loadSession } from '@/lib/session';
import { connectSocket, type AppSocket } from '@/lib/socket';

const MAX_MESSAGE_LENGTH = 500;
const REFUSAL_CODES = new Set<string>([
  SOCKET_ERROR_CODES.rateLimited,
  SOCKET_ERROR_CODES.muted,
  SOCKET_ERROR_CODES.notAllowed,
]);

function remainingLabel(expiresAt: string) {
  const minutes = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? `${hours} sa ${minutes % 60} dk sonra kaybolur`
    : `${minutes} dk sonra kaybolur`;
}

export function ConversationClient({ conversationId }: { conversationId: string }) {
  const [myId, setMyId] = useState<string | null>(null);
  const [page, setPage] = useState<Omit<MessagesPage, 'messages'> | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const socketRef = useRef<AppSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef('');
  const stickToBottomRef = useRef(true);

  const url = `/api/conversations/${conversationId}/messages`;

  const loadLatest = useCallback(async () => {
    try {
      const { messages: latest, ...rest } = await apiGet(url, messagesPageSchema);
      setPage(rest);
      setMessages(latest);
      setStatus('ready');
    } catch (error) {
      setStatus(error instanceof ApiError && error.status === 404 ? 'missing' : 'failed');
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    let detach = () => {};

    loadSession()
      .then(async ({ token, user }) => {
        if (cancelled) return;
        setMyId(user.id);
        const socket = connectSocket(token);
        socketRef.current = socket;

        const markRead = () => socket.emit('dm:read', { conversationId });
        const onMessage = (payload: ServerEventPayload<'dm:message'>) => {
          const parsed = serverEventSchemas['dm:message'].safeParse(payload);
          if (!parsed.success || parsed.data.conversationId !== conversationId) return;
          const { message } = parsed.data;
          stickToBottomRef.current = true;
          setMessages((current) =>
            current.some((entry) => entry.id === message.id) ? current : [...current, message],
          );
          if (message.senderId !== user.id) markRead();
        };
        const onError = (payload: ServerEventPayload<'error'>) => {
          const parsed = serverEventSchemas.error.safeParse(payload);
          if (!parsed.success) return;
          setNotice(parsed.data.message);
          if (REFUSAL_CODES.has(parsed.data.code)) {
            setDraft((current) => current || lastSentRef.current);
          }
        };
        const onReconnect = () => {
          void loadLatest();
          markRead();
        };

        socket.on('dm:message', onMessage);
        socket.on('error', onError);
        socket.on('connect', onReconnect);
        detach = () => {
          socket.off('dm:message', onMessage);
          socket.off('error', onError);
          socket.off('connect', onReconnect);
        };

        await loadLatest();
        if (socket.connected) markRead();
      })
      .catch(() => setStatus('failed'));

    return () => {
      cancelled = true;
      detach();
    };
  }, [conversationId, loadLatest]);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  // Messages disappear from the screen as soon as they pass their 24-hour limit.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setMessages((current) => {
        const visible = current.filter((entry) => new Date(entry.expiresAt).getTime() > now);
        return visible.length === current.length ? current : visible;
      });
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const loadOlder = async () => {
    if (!page?.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    const list = listRef.current;
    const previousHeight = list?.scrollHeight ?? 0;
    try {
      const older = await apiGet(
        `${url}?before=${encodeURIComponent(page.nextCursor)}`,
        messagesPageSchema,
      );
      stickToBottomRef.current = false;
      setPage((current) => current && { ...current, nextCursor: older.nextCursor });
      setMessages((current) => [...older.messages, ...current]);
      requestAnimationFrame(() => {
        if (list) list.scrollTop = list.scrollHeight - previousHeight;
      });
    } catch {
      setNotice('Eski mesajlar yüklenemedi.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    lastSentRef.current = body;
    socketRef.current?.emit('dm:send', { conversationId, body });
    setDraft('');
  };

  if (status === 'missing') {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4">
        <PageHeader title="Mesajlar" backHref="/messages" />
        <p className="py-8 text-center text-muted">Bu sohbete artık erişilemiyor.</p>
      </div>
    );
  }

  const category = CATEGORIES.find((item) => item.id === page?.metInCategory);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col px-4">
      <PageHeader
        backHref="/messages"
        title={
          page ? (
            <span className="flex items-center gap-2">
              <Avatar id={page.friend.avatarId} size={36} />
              <span className="min-w-0 truncate">
                {page.friend.online ? '🟢 ' : '⚪ '}
                {page.friend.nickname}
              </span>
            </span>
          ) : (
            'Mesajlar'
          )
        }
      >
        {page && (
          <Link
            href={`/play?invite=${page.friend.id}`}
            className="flex min-h-touch items-center rounded-lg bg-accent px-2 text-xs font-semibold text-white"
          >
            Birlikte oyna
          </Link>
        )}
      </PageHeader>

      <p className="bg-ink/5 px-2 py-1 text-center text-xs font-semibold text-muted">
        ⏳ Mesajlar 24 saat sonra kaybolur.
      </p>

      <div ref={listRef} aria-live="polite" className="flex-1 space-y-2 overflow-y-auto py-3">
        {status === 'loading' && <p className="text-center text-muted">Yükleniyor…</p>}
        {status === 'failed' && (
          <button
            type="button"
            onClick={loadLatest}
            className="min-h-touch w-full text-sm underline"
          >
            Yüklenemedi, tekrar dene
          </button>
        )}
        {page?.nextCursor && (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingOlder}
            className="min-h-touch w-full text-sm underline disabled:opacity-50"
          >
            Eski mesajları göster
          </button>
        )}
        {page && !page.nextCursor && (
          <p className="text-center text-xs text-muted">
            {category
              ? `${page.friend.nickname} ile ${category.name} oynayarak tanıştınız 🎉`
              : `${page.friend.nickname} ile arkadaşsınız 🎉`}
          </p>
        )}
        {messages.map((message) => {
          const mine = message.senderId === myId;
          return (
            <div key={message.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <p
                title={remainingLabel(message.expiresAt)}
                onClick={() =>
                  setSelectedId((current) => (current === message.id ? null : message.id))
                }
                className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                  mine ? 'bg-ink text-cream' : 'border border-ink/10 bg-white'
                }`}
              >
                <LinkedText text={message.body} />
              </p>
              {selectedId === message.id && (
                <span className="mt-0.5 text-[11px] text-muted">
                  {remainingLabel(message.expiresAt)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {notice && (
        <p role="alert" className="py-1 text-center text-xs font-semibold text-danger">
          {notice}
        </p>
      )}

      <form onSubmit={submit} className="flex items-end gap-2 border-t border-ink/10 py-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Mesajın</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            autoComplete="off"
            placeholder="Mesaj yaz…"
            className="h-11 w-full rounded-xl border-2 border-ink/20 bg-white px-3 text-base outline-none focus:border-ink"
          />
        </label>
        <button
          type="submit"
          disabled={!draft.trim()}
          className="min-h-touch rounded-xl bg-accent px-4 font-semibold text-white disabled:opacity-50"
        >
          Gönder
        </button>
      </form>
    </div>
  );
}
