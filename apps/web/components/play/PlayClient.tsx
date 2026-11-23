'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SOCKET_AUTH_ERRORS,
  SOCKET_ERROR_CODES,
  serverEventSchemas,
  type CardsOffer,
  type ChatMessage,
  type ChatStart,
  type MatchFound,
  type PublicUser,
  type ReportReason,
  type ServerEventPayload,
} from 'shared';
import { createChime, flashTitle } from '@/lib/notify';
import { loadSession } from '@/lib/session';
import { connectSocket, type AppSocket } from '@/lib/socket';
import { CardPicker } from './CardPicker';
import { CategorySpin } from './CategorySpin';
import { ChatScreen, type ChatEndReason, type FriendState } from './ChatScreen';
import { GameOver } from './GameOver';
import { GameScreen, type AnswerPayload, type RoundResult, type RoundStart } from './GameScreen';

const NOBODY_AFTER_SEC = 60;
const CALM_HINT_AFTER_SEC = 20;
const TYPING_VISIBLE_MS = 2_500;
const INVITE_CLOSED_MESSAGES = {
  declined: 'Arkadaşın daveti kabul etmedi.',
  expired: 'Davetin süresi doldu.',
  cancelled: 'Davet geri çekildi.',
  unavailable: 'Bu davet artık geçerli değil.',
} as const;
const TYPING_SEND_INTERVAL_MS = 1_500;
const MESSAGE_REFUSAL_CODES = new Set<string>([
  SOCKET_ERROR_CODES.rateLimited,
  SOCKET_ERROR_CODES.contactBlocked,
  SOCKET_ERROR_CODES.muted,
]);

type Phase =
  | 'connecting'
  | 'searching'
  | 'nobody'
  | 'spinning'
  | 'playing'
  | 'finished'
  | 'picking'
  | 'chatting'
  | 'inviting'
  | 'blocked';

const primaryButton =
  'flex min-h-touch w-full items-center justify-center rounded-xl bg-accent px-4 py-3 font-semibold text-white';
const secondaryButton =
  'flex min-h-touch w-full items-center justify-center rounded-xl border-2 border-ink px-4 py-3 font-semibold';

function isInGame(phase: Phase) {
  return ['spinning', 'playing', 'finished', 'picking', 'chatting'].includes(phase);
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
  const [offer, setOffer] = useState<CardsOffer | null>(null);
  const [pickDeadline, setPickDeadline] = useState(0);
  const [pinned, setPinned] = useState<ChatStart['pinned']>([]);
  const [chatDeadline, setChatDeadline] = useState<number | null>(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [opponentTyping, setOpponentTyping] = useState(false);
  const [chatEnded, setChatEnded] = useState<ChatEndReason | null>(null);
  const [leftByMe, setLeftByMe] = useState(false);
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const [noticeIsError, setNoticeIsError] = useState(true);
  const [refusedCount, setRefusedCount] = useState(0);
  const [reported, setReported] = useState(false);
  const [blockedUser, setBlockedUser] = useState(false);
  const [friendState, setFriendState] = useState<FriendState>('none');
  const [friendRequestId, setFriendRequestId] = useState<string | null>(null);
  const [friendConversationId, setFriendConversationId] = useState<string | null>(null);

  const phaseRef = useRef<Phase>('connecting');
  const socketRef = useRef<AppSocket | null>(null);
  const notifyRef = useRef(false);
  const chimeRef = useRef<(() => void) | null>(null);
  const stopFlashRef = useRef<(() => void) | null>(null);
  const finishedRef = useRef(false);
  const opponentIdRef = useRef<string | null>(null);
  const inviteIdRef = useRef<string | null>(null);
  const inviteTimerRef = useRef<number | undefined>(undefined);
  const pendingEntryRef = useRef<{ inviteFriend?: string; acceptInvite?: string } | null>(null);
  const typingTimerRef = useRef<number | undefined>(undefined);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const lastTypingSentRef = useRef(0);

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
    setOffer(null);
    setPinned([]);
    setMessages([]);
    setOpponentTyping(false);
    setChatEnded(null);
    setLeftByMe(false);
    setChatNotice(null);
    setReported(false);
    setBlockedUser(false);
    setFriendState('none');
    setFriendRequestId(null);
    setFriendConversationId(null);
    opponentIdRef.current = null;
    finishedRef.current = false;
    setPhase('searching');
    const socket = socketRef.current;
    if (socket?.connected) socket.emit('queue:join', {});
    else socket?.connect();
  }, [setPhase]);

  // Tells the toast layer not to interrupt a running game or chat.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.playBusy = isInGame(phase) && !chatEnded ? '1' : '';
    return () => {
      root.dataset.playBusy = '';
    };
  }, [phase, chatEnded]);

  useEffect(() => {
    let cancelled = false;
    let detach = () => {};

    if (!pendingEntryRef.current) {
      const params = new URLSearchParams(window.location.search);
      const inviteFriend = params.get('invite') ?? undefined;
      const acceptInvite = params.get('acceptInvite') ?? undefined;
      pendingEntryRef.current = { inviteFriend, acceptInvite };
      // A reload must not send the same invite again.
      if (inviteFriend || acceptInvite) window.history.replaceState(null, '', '/play');
    }

    const showNotice = (message: string, isError = true) => {
      setChatNotice(message);
      setNoticeIsError(isError);
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setChatNotice(null), 4_000);
    };

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

        const enterPlay = () => {
          const entry = pendingEntryRef.current;
          pendingEntryRef.current = {};
          if (entry?.inviteFriend) {
            setPhase('inviting');
            socket.emit('invite:create', { friendId: entry.inviteFriend });
          } else if (entry?.acceptInvite) {
            setPhase('inviting');
            socket.emit('invite:respond', { inviteId: entry.acceptInvite, accept: true });
          } else {
            startSearch();
          }
        };
        const closeInvite = () => {
          inviteIdRef.current = null;
          window.clearTimeout(inviteTimerRef.current);
        };
        const onInviteCreated = (payload: ServerEventPayload<'invite:created'>) => {
          const parsed = serverEventSchemas['invite:created'].safeParse(payload);
          if (!parsed.success) return;
          inviteIdRef.current = parsed.data.inviteId;
          window.clearTimeout(inviteTimerRef.current);
          inviteTimerRef.current = window.setTimeout(() => {
            if (phaseRef.current !== 'inviting') return;
            socket.emit('invite:cancel', { inviteId: parsed.data.inviteId });
            closeInvite();
            block(INVITE_CLOSED_MESSAGES.expired);
          }, parsed.data.expiresInMs);
        };
        const onInviteClosed = (payload: ServerEventPayload<'invite:closed'>) => {
          const parsed = serverEventSchemas['invite:closed'].safeParse(payload);
          if (!parsed.success || parsed.data.inviteId !== inviteIdRef.current) return;
          closeInvite();
          if (phaseRef.current === 'inviting') block(INVITE_CLOSED_MESSAGES[parsed.data.reason]);
        };
        const onFriendRequested = (payload: ServerEventPayload<'friend:requested'>) => {
          const parsed = serverEventSchemas['friend:requested'].safeParse(payload);
          if (parsed.success && parsed.data.userId === opponentIdRef.current) {
            setFriendState('sent');
          }
        };
        const onFriendIncoming = (payload: ServerEventPayload<'friend:incoming'>) => {
          const parsed = serverEventSchemas['friend:incoming'].safeParse(payload);
          if (parsed.success && parsed.data.from.id === opponentIdRef.current) {
            setFriendRequestId(parsed.data.requestId);
            setFriendState('incoming');
          }
        };
        const onFriendAccepted = (payload: ServerEventPayload<'friend:accepted'>) => {
          const parsed = serverEventSchemas['friend:accepted'].safeParse(payload);
          if (parsed.success && parsed.data.userId === opponentIdRef.current) {
            setFriendConversationId(parsed.data.conversationId);
            setFriendState('friends');
          }
        };

        const onConnect = () => {
          if (phaseRef.current === 'searching') startSearch();
          else if (
            phaseRef.current === 'connecting' ||
            (isInGame(phaseRef.current) && !finishedRef.current)
          ) {
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
          closeInvite();
          opponentIdRef.current = parsed.data.opponent.id;
          if (notifyRef.current && !parsed.data.resumed) {
            chimeRef.current?.();
            stopFlashRef.current?.();
            stopFlashRef.current = flashTitle();
            notifyRef.current = false;
            setNotifying(false);
          }
          setMatch(parsed.data);
          // A resumed room restores its own stage right after this, without replaying the spin.
          if (!parsed.data.resumed) {
            setGameOver(null);
            setPhase('spinning');
          }
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
          if (parsed.data.forfeit) finishedRef.current = true;
          setPhase('finished');
        };
        const onOffer = (payload: CardsOffer) => {
          const parsed = serverEventSchemas['cards:offer'].safeParse(payload);
          if (!parsed.success) return;
          setOffer(parsed.data);
          setPickDeadline(Date.now() + parsed.data.remainingMs);
          setPhase('picking');
        };
        const onChatStart = (payload: ChatStart) => {
          const parsed = serverEventSchemas['chat:start'].safeParse(payload);
          if (!parsed.success) return;
          setPinned(parsed.data.pinned);
          const { remainingMs } = parsed.data;
          setChatDeadline(remainingMs === null ? null : Date.now() + remainingMs);
          // A friends' room has no time limit and is only ever opened between friends.
          if (remainingMs === null) setFriendState('friends');
          setMessages([]);
          setChatEnded(null);
          setPhase('chatting');
        };
        const onChatMessage = (payload: ChatMessage) => {
          const parsed = serverEventSchemas['chat:message'].safeParse(payload);
          if (!parsed.success) return;
          setOpponentTyping(false);
          setMessages((current) =>
            current.some((message) => message.id === parsed.data.id)
              ? current
              : [...current, parsed.data],
          );
        };
        const onChatTyping = (payload: ServerEventPayload<'chat:typing'>) => {
          if (!serverEventSchemas['chat:typing'].safeParse(payload).success) return;
          setOpponentTyping(true);
          window.clearTimeout(typingTimerRef.current);
          typingTimerRef.current = window.setTimeout(
            () => setOpponentTyping(false),
            TYPING_VISIBLE_MS,
          );
        };
        const onChatEnded = (payload: ServerEventPayload<'chat:ended'>) => {
          const parsed = serverEventSchemas['chat:ended'].safeParse(payload);
          if (!parsed.success) return;
          finishedRef.current = true;
          setChatEnded(parsed.data.reason);
          setPhase('chatting');
        };
        const onModeration = (payload: ServerEventPayload<'moderation:result'>) => {
          const parsed = serverEventSchemas['moderation:result'].safeParse(payload);
          if (!parsed.success) return;
          if (parsed.data.action === 'report') setReported(true);
          else setBlockedUser(true);
          showNotice(
            parsed.data.action === 'report'
              ? 'Raporun alındı, teşekkürler.'
              : 'Kullanıcı engellendi. Bir daha eşleşmeyeceksiniz.',
            false,
          );
        };
        const onError = (payload: ServerEventPayload<'error'>) => {
          const parsed = serverEventSchemas.error.safeParse(payload);
          if (!parsed.success) return;
          const { code, message } = parsed.data;
          if (code === SOCKET_ERROR_CODES.termsRequired) {
            router.replace('/');
          } else if (code === SOCKET_ERROR_CODES.noActiveGame) {
            if (phaseRef.current === 'connecting') enterPlay();
            else if (isInGame(phaseRef.current) && !finishedRef.current) {
              block('Bağlantın koptuğu için oyun sona erdi.');
            }
          } else if (code === SOCKET_ERROR_CODES.gameFailed) {
            block(message);
          } else if (code === SOCKET_ERROR_CODES.alreadyFriends) {
            setFriendState('friends');
          } else if (phaseRef.current === 'inviting') {
            closeInvite();
            block(message);
          } else if (phaseRef.current === 'searching') {
            block(message);
          } else if (phaseRef.current === 'chatting' || phaseRef.current === 'picking') {
            showNotice(message);
            if (MESSAGE_REFUSAL_CODES.has(code)) setRefusedCount((count) => count + 1);
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
        socket.on('cards:offer', onOffer);
        socket.on('chat:start', onChatStart);
        socket.on('chat:message', onChatMessage);
        socket.on('chat:typing', onChatTyping);
        socket.on('chat:ended', onChatEnded);
        socket.on('moderation:result', onModeration);
        socket.on('invite:created', onInviteCreated);
        socket.on('invite:closed', onInviteClosed);
        socket.on('friend:requested', onFriendRequested);
        socket.on('friend:incoming', onFriendIncoming);
        socket.on('friend:accepted', onFriendAccepted);
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
          socket.off('cards:offer', onOffer);
          socket.off('chat:start', onChatStart);
          socket.off('chat:message', onChatMessage);
          socket.off('chat:typing', onChatTyping);
          socket.off('chat:ended', onChatEnded);
          socket.off('moderation:result', onModeration);
          socket.off('invite:created', onInviteCreated);
          socket.off('invite:closed', onInviteClosed);
          socket.off('friend:requested', onFriendRequested);
          socket.off('friend:incoming', onFriendIncoming);
          socket.off('friend:accepted', onFriendAccepted);
          if (phaseRef.current === 'inviting' && inviteIdRef.current) {
            socket.emit('invite:cancel', { inviteId: inviteIdRef.current });
            closeInvite();
          }
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
      window.clearTimeout(typingTimerRef.current);
      window.clearTimeout(noticeTimerRef.current);
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

  const sendTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_SEND_INTERVAL_MS) return;
    lastTypingSentRef.current = now;
    socketRef.current?.emit('chat:typing', {});
  };

  const leaveChat = () => {
    setLeftByMe(true);
    socketRef.current?.emit('chat:leave', {});
  };

  const reportOpponent = (reason: ReportReason, note: string) => {
    if (!match) return;
    const trimmed = note.trim();
    socketRef.current?.emit('user:report', {
      userId: match.opponent.id,
      reason,
      ...(trimmed ? { note: trimmed } : {}),
    });
  };

  const blockOpponent = () => {
    if (!match) return;
    setLeftByMe(true);
    socketRef.current?.emit('user:block', { userId: match.opponent.id });
  };

  const cancelInvite = () => {
    if (inviteIdRef.current) {
      socketRef.current?.emit('invite:cancel', { inviteId: inviteIdRef.current });
      inviteIdRef.current = null;
    }
    window.clearTimeout(inviteTimerRef.current);
    setPhase('connecting');
    router.push('/friends');
  };

  const addFriend = () => {
    if (match) socketRef.current?.emit('friend:request', { userId: match.opponent.id });
  };

  const acceptFriend = () => {
    if (friendRequestId) {
      socketRef.current?.emit('friend:respond', { requestId: friendRequestId, accept: true });
    }
  };

  const rateChat = (value: 1 | -1) => {
    if (match) socketRef.current?.emit('chat:rate', { roomId: match.roomId, value });
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
        phase === 'playing' || phase === 'chatting'
          ? ''
          : phase === 'picking'
            ? 'py-2'
            : 'justify-center py-6'
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

      {phase === 'inviting' && (
        <>
          <span aria-hidden="true" className="text-5xl">
            🎮
          </span>
          <div role="status">
            <h1 className="text-2xl font-bold">Arkadaşın bekleniyor…</h1>
            <p className="mt-1 text-sm text-muted">Davet 1 dakika geçerlidir.</p>
          </div>
          <button type="button" onClick={cancelInvite} className={secondaryButton}>
            Vazgeç
          </button>
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

      {phase === 'finished' &&
        match &&
        gameOver &&
        me &&
        (gameOver.forfeit ? (
          <GameOver me={me} match={match} result={gameOver} onNewGame={startSearch} />
        ) : (
          <p role="status" className="text-muted">
            Kartlar hazırlanıyor…
          </p>
        ))}

      {phase === 'picking' && match && gameOver && offer && me && (
        <CardPicker
          key={match.roomId}
          me={me}
          match={match}
          result={gameOver}
          offer={offer}
          deadline={pickDeadline}
          onPick={(cardIds) => socketRef.current?.emit('cards:pick', { cardIds })}
        />
      )}

      {phase === 'chatting' && match && me && (
        <ChatScreen
          key={match.roomId}
          me={me}
          match={match}
          winnerId={gameOver?.winnerId ?? null}
          pinned={pinned}
          deadline={chatDeadline}
          messages={messages}
          opponentTyping={opponentTyping}
          ended={chatEnded}
          leftByMe={leftByMe}
          notice={chatNotice}
          noticeIsError={noticeIsError}
          refusedCount={refusedCount}
          reported={reported}
          blocked={blockedUser}
          onSend={(body) => socketRef.current?.emit('chat:send', { body })}
          onTyping={sendTyping}
          onLeave={leaveChat}
          onReport={reportOpponent}
          onBlock={blockOpponent}
          onRate={rateChat}
          onNewGame={startSearch}
          friendState={friendState}
          friendConversationId={friendConversationId}
          onAddFriend={addFriend}
          onAcceptFriend={acceptFriend}
        />
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
