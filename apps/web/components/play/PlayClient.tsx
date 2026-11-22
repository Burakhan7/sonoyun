'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CATEGORIES,
  ENGINES,
  SOCKET_AUTH_ERRORS,
  SOCKET_ERROR_CODES,
  serverEventSchemas,
  type MatchFound,
  type ServerEventPayload,
} from 'shared';
import { Avatar } from '@/components/Avatar';
import { createChime, flashTitle } from '@/lib/notify';
import { loadSession } from '@/lib/session';
import { connectSocket, type AppSocket } from '@/lib/socket';
import { CategorySpin } from './CategorySpin';

const NOBODY_AFTER_SEC = 60;
const CALM_HINT_AFTER_SEC = 20;
const SPIN_MS = 3_000;

type Phase = 'connecting' | 'searching' | 'nobody' | 'spinning' | 'ready' | 'blocked';

const primaryButton =
  'flex min-h-touch w-full items-center justify-center rounded-xl bg-accent px-4 py-3 font-semibold text-white';
const secondaryButton =
  'flex min-h-touch w-full items-center justify-center rounded-xl border-2 border-ink px-4 py-3 font-semibold';

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function PlayClient() {
  const router = useRouter();
  const [phase, setPhaseState] = useState<Phase>('connecting');
  const [waitingSec, setWaitingSec] = useState(0);
  const [online, setOnline] = useState<number | null>(null);
  const [match, setMatch] = useState<MatchFound | null>(null);
  const [blockedMessage, setBlockedMessage] = useState('');
  const [notifying, setNotifying] = useState(false);

  const phaseRef = useRef<Phase>('connecting');
  const socketRef = useRef<AppSocket | null>(null);
  const notifyRef = useRef(false);
  const chimeRef = useRef<(() => void) | null>(null);
  const stopFlashRef = useRef<(() => void) | null>(null);
  const spinTimerRef = useRef<number | undefined>(undefined);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const startSearch = useCallback(() => {
    setWaitingSec(0);
    setMatch(null);
    setPhase('searching');
    const socket = socketRef.current;
    if (socket?.connected) socket.emit('queue:join', {});
    else socket?.connect();
  }, [setPhase]);

  useEffect(() => {
    let cancelled = false;
    let detach = () => {};

    const block = (message: string) => {
      setBlockedMessage(message);
      setPhase('blocked');
    };

    loadSession()
      .then(({ token }) => {
        if (cancelled) return;

        // The server enforces 18+ consent on queue:join and answers with terms_required.
        const socket = connectSocket(token);
        socketRef.current = socket;

        const onConnect = () => {
          if (phaseRef.current === 'connecting' || phaseRef.current === 'searching') startSearch();
        };
        const onConnectError = (error: Error) => {
          if (error.message === SOCKET_AUTH_ERRORS.banned) {
            block('Hesabın geçici olarak kısıtlandı.');
          } else if (error.message === SOCKET_AUTH_ERRORS.unauthorized) {
            router.replace('/');
          }
        };
        const onCount = (payload: ServerEventPayload<'online:count'>) => {
          const parsed = serverEventSchemas['online:count'].safeParse(payload);
          if (parsed.success) setOnline(parsed.data.online);
        };
        const onStatus = (payload: ServerEventPayload<'queue:status'>) => {
          const parsed = serverEventSchemas['queue:status'].safeParse(payload);
          if (!parsed.success || phaseRef.current !== 'searching') return;
          setWaitingSec(parsed.data.waitingSec);
          if (parsed.data.waitingSec >= NOBODY_AFTER_SEC && !notifyRef.current) {
            socket.emit('queue:leave', {});
            setPhase('nobody');
          }
        };
        const onMatch = (payload: MatchFound) => {
          const parsed = serverEventSchemas['match:found'].safeParse(payload);
          if (!parsed.success) return;
          if (notifyRef.current) {
            chimeRef.current?.();
            stopFlashRef.current?.();
            stopFlashRef.current = flashTitle();
            notifyRef.current = false;
            setNotifying(false);
          }
          setMatch(parsed.data);
          setPhase('spinning');
          window.clearTimeout(spinTimerRef.current);
          spinTimerRef.current = window.setTimeout(() => setPhase('ready'), SPIN_MS);
        };
        const onError = (payload: ServerEventPayload<'error'>) => {
          const parsed = serverEventSchemas.error.safeParse(payload);
          if (!parsed.success) return;
          if (parsed.data.code === SOCKET_ERROR_CODES.termsRequired) router.replace('/');
          else if (phaseRef.current === 'searching') block(parsed.data.message);
        };

        socket.on('connect', onConnect);
        socket.on('connect_error', onConnectError);
        socket.on('online:count', onCount);
        socket.on('queue:status', onStatus);
        socket.on('match:found', onMatch);
        socket.on('error', onError);
        detach = () => {
          socket.off('connect', onConnect);
          socket.off('connect_error', onConnectError);
          socket.off('online:count', onCount);
          socket.off('queue:status', onStatus);
          socket.off('match:found', onMatch);
          socket.off('error', onError);
          if (phaseRef.current === 'searching') socket.emit('queue:leave', {});
        };

        if (socket.connected) startSearch();
      })
      .catch(() => {
        if (!cancelled) block('Sunucuya bağlanılamadı. Lütfen tekrar dene.');
      });

    return () => {
      cancelled = true;
      detach();
      window.clearTimeout(spinTimerRef.current);
      stopFlashRef.current?.();
    };
  }, [router, setPhase, startSearch]);

  const cancel = () => {
    if (phaseRef.current === 'searching') socketRef.current?.emit('queue:leave', {});
    setPhase('connecting');
    router.push('/');
  };

  const keepSearching = () => {
    notifyRef.current = false;
    setNotifying(false);
    startSearch();
  };

  const searchWithAlert = () => {
    chimeRef.current ??= createChime();
    notifyRef.current = true;
    setNotifying(true);
    startSearch();
  };

  const invite = async () => {
    const url = window.location.origin;
    const text = 'Önce oyun, sonra sohbet! Gel bir el oynayalım:';
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Önce oyun, sonra sohbet', text, url });
      } catch {
        // The share sheet was dismissed.
      }
      return;
    }
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-6 text-center">
      {phase === 'connecting' && <p className="text-muted">Bağlanıyor…</p>}

      {phase === 'searching' && (
        <>
          <span aria-hidden="true" className="relative flex h-24 w-24 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/30 motion-reduce:animate-none" />
            <span className="relative text-5xl">🎲</span>
          </span>
          <div role="status">
            <h1 className="text-2xl font-bold">Rakip aranıyor…</h1>
            <p className="mt-1 font-mono text-lg text-muted">{formatElapsed(waitingSec)}</p>
            {notifying && (
              <p className="mt-2 text-sm text-muted">
                🔔 Biri gelince ses çalacak. Bu sekmeyi açık tut.
              </p>
            )}
            {!notifying && waitingSec >= CALM_HINT_AFTER_SEC && (
              <p className="mt-2 text-sm text-muted">Biraz sakin bir an, birazdan biri gelir.</p>
            )}
          </div>
          <button type="button" onClick={cancel} className={secondaryButton}>
            İptal
          </button>
        </>
      )}

      {phase === 'nobody' && (
        <>
          <div>
            <h1 className="text-2xl font-bold">Şu an kimse yok 😕</h1>
            {online !== null && (
              <p className="mt-1 text-muted">🟢 {online.toLocaleString('tr-TR')} çevrimiçi</p>
            )}
          </div>
          <div className="flex w-full flex-col gap-3">
            <button type="button" onClick={invite} className={primaryButton}>
              Arkadaşını davet et
            </button>
            <button type="button" onClick={keepSearching} className={secondaryButton}>
              Aramaya devam et
            </button>
            <button type="button" onClick={searchWithAlert} className={secondaryButton}>
              🔔 Bildirim al
            </button>
            <Link href="/" className="flex min-h-touch items-center justify-center underline">
              Ana sayfaya dön
            </Link>
          </div>
        </>
      )}

      {phase === 'spinning' && match && <CategorySpin match={match} />}

      {phase === 'ready' && match && (
        <>
          <Avatar id={match.opponent.avatarId} size={72} />
          <div>
            <h1 className="text-2xl font-bold">{match.opponent.nickname} ile eşleştin</h1>
            <p className="mt-2 text-muted">
              {CATEGORIES.find((category) => category.id === match.category)?.emoji}{' '}
              {CATEGORIES.find((category) => category.id === match.category)?.name} ·{' '}
              {ENGINES[match.engine].name}
            </p>
            <p className="mt-3 text-sm text-muted">
              Oyun ekranı henüz hazır değil, çok yakında burada oynayacaksın.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3">
            <button type="button" onClick={startSearch} className={primaryButton}>
              Yeni oyun
            </button>
            <Link href="/" className="flex min-h-touch items-center justify-center underline">
              Ana sayfaya dön
            </Link>
          </div>
        </>
      )}

      {phase === 'blocked' && (
        <>
          <p role="alert" className="font-semibold">
            {blockedMessage}
          </p>
          <button type="button" onClick={startSearch} className={primaryButton}>
            Tekrar dene
          </button>
          <Link href="/" className="flex min-h-touch items-center justify-center underline">
            Ana sayfaya dön
          </Link>
        </>
      )}
    </main>
  );
}
