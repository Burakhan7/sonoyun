'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SOCKET_AUTH_ERRORS,
  SOCKET_ERROR_CODES,
  serverEventSchemas,
  type MatchFound,
  type PublicUser,
  type ServerEventPayload,
} from 'shared';
import { createChime, flashTitle } from '@/lib/notify';
import { loadSession } from '@/lib/session';
import { connectSocket, type AppSocket } from '@/lib/socket';
import { CategorySpin } from './CategorySpin';
import { GameOver } from './GameOver';
import { GameScreen, type AnswerPayload, type RoundResult, type RoundStart } from './GameScreen';

const NOBODY_AFTER_SEC = 60;
const CALM_HINT_AFTER_SEC = 20;

type Phase =
  'connecting' | 'searching' | 'nobody' | 'spinning' | 'playing' | 'finished' | 'blocked';

const primaryButton =
  'flex min-h-touch w-full items-center justify-center rounded-xl bg-accent px-4 py-3 font-semibold text-white';
const secondaryButton =
  'flex min-h-touch w-full items-center justify-center rounded-xl border-2 border-ink px-4 py-3 font-semibold';

function isInGame(phase: Phase) {
  return phase === 'spinning' || phase === 'playing';
}

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
  const [me, setMe] = useState<PublicUser | null>(null);
  const [round, setRound] = useState<RoundStart | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [gameOver, setGameOver] = useState<ServerEventPayload<'game:over'> | null>(null);

  const phaseRef = useRef<Phase>('connecting');
  const socketRef = useRef<AppSocket | null>(null);
  const notifyRef = useRef(false);
  const chimeRef = useRef<(() => void) | null>(null);
  const stopFlashRef = useRef<(() => void) | null>(null);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const startSearch = useCallback(() => {
    setWaitingSec(0);
    setMatch(null);
    setRound(null);
    setRoundResult(null);
    setGameOver(null);
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
      .then(({ token, user }) => {
        if (cancelled) return;
        setMe(user);

        // The server enforces 18+ consent on queue:join and answers with terms_required.
        const socket = connectSocket(token);
        socketRef.current = socket;

        const onConnect = () => {
          if (phaseRef.current === 'searching') startSearch();
          else if (phaseRef.current === 'connecting' || isInGame(phaseRef.current)) {
            socket.emit('game:resume', {});
          }
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
          setGameOver(null);
          // A resumed game receives round:start right after this and skips the spin.
          if (phaseRef.current !== 'playing') setPhase('spinning');
        };
        const onRoundStart = (payload: RoundStart) => {
          const parsed = serverEventSchemas['round:start'].safeParse(payload);
          if (!parsed.success) return;
          setRound(parsed.data);
          setRoundResult(null);
          setDeadline(Date.now() + parsed.data.remainingMs);
          setPhase('playing');
        };
        const onRoundResult = (payload: RoundResult) => {
          const parsed = serverEventSchemas['round:result'].safeParse(payload);
          if (parsed.success) setRoundResult(parsed.data);
        };
        const onGameOver = (payload: ServerEventPayload<'game:over'>) => {
          const parsed = serverEventSchemas['game:over'].safeParse(payload);
          if (!parsed.success) return;
          setGameOver(parsed.data);
          setPhase('finished');
        };
        const onError = (payload: ServerEventPayload<'error'>) => {
          const parsed = serverEventSchemas.error.safeParse(payload);
          if (!parsed.success) return;
          const { code, message } = parsed.data;
          if (code === SOCKET_ERROR_CODES.termsRequired) {
            router.replace('/');
          } else if (code === SOCKET_ERROR_CODES.noActiveGame) {
            if (phaseRef.current === 'connecting') startSearch();
            else if (isInGame(phaseRef.current)) block('Bağlantın koptuğu için oyun sona erdi.');
          } else if (code === SOCKET_ERROR_CODES.gameFailed) {
            block(message);
          } else if (phaseRef.current === 'searching') {
            block(message);
          }
        };

        socket.on('connect', onConnect);
        socket.on('connect_error', onConnectError);
        socket.on('online:count', onCount);
        socket.on('queue:status', onStatus);
        socket.on('match:found', onMatch);
        socket.on('round:start', onRoundStart);
        socket.on('round:result', onRoundResult);
        socket.on('game:over', onGameOver);
        socket.on('error', onError);
        detach = () => {
          socket.off('connect', onConnect);
          socket.off('connect_error', onConnectError);
          socket.off('online:count', onCount);
          socket.off('queue:status', onStatus);
          socket.off('match:found', onMatch);
          socket.off('round:start', onRoundStart);
          socket.off('round:result', onRoundResult);
          socket.off('game:over', onGameOver);
          socket.off('error', onError);
          if (phaseRef.current === 'searching') socket.emit('queue:leave', {});
        };

        if (socket.connected) socket.emit('game:resume', {});
      })
      .catch(() => {
        if (!cancelled) block('Sunucuya bağlanılamadı. Lütfen tekrar dene.');
      });

    return () => {
      cancelled = true;
      detach();
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

  const sendAnswer = (payload: AnswerPayload) => {
    if (round) socketRef.current?.emit('game:answer', { roundNo: round.roundNo, ...payload });
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
    <main
      className={`mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-6 px-4 text-center ${
        phase === 'playing' ? '' : 'justify-center py-6'
      }`}
    >
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

      {phase === 'playing' && match && round && me && (
        <GameScreen
          key={round.roundNo}
          me={me}
          match={match}
          round={round}
          result={roundResult}
          deadline={deadline}
          onAnswer={sendAnswer}
        />
      )}

      {phase === 'finished' && match && gameOver && me && (
        <GameOver me={me} match={match} result={gameOver} onNewGame={startSearch} />
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
