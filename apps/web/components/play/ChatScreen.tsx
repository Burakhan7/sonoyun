'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  ChatMessage,
  ChatStart,
  MatchFound,
  PublicUser,
  ReportReason,
  ServerEventPayload,
} from 'shared';
import { Avatar } from '@/components/Avatar';

const MAX_MESSAGE_LENGTH = 500;
const WARNING_MS = 60_000;

const REPORT_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: 'taciz', label: 'Taciz' },
  { value: 'kufur', label: 'Küfür veya hakaret' },
  { value: 'spam', label: 'Spam' },
  { value: 'reşit-olmayan', label: 'Reşit olmadığını düşünüyorum' },
  { value: 'diger', label: 'Diğer' },
];

export type FriendState = 'none' | 'sent' | 'incoming' | 'friends';
export type ChatEndReason = ServerEventPayload<'chat:ended'>['reason'];

interface ChatScreenProps {
  me: PublicUser;
  match: MatchFound;
  winnerId: string | null;
  pinned: ChatStart['pinned'];
  /** Null in a friends' room, whose chat has no time limit. */
  deadline: number | null;
  messages: ChatMessage[];
  opponentTyping: boolean;
  ended: ChatEndReason | null;
  leftByMe: boolean;
  notice: string | null;
  noticeIsError: boolean;
  /** Increases each time the server refuses a message, so its text can be restored. */
  refusedCount: number;
  reported: boolean;
  blocked: boolean;
  onSend: (body: string) => void;
  onTyping: () => void;
  onLeave: () => void;
  onReport: (reason: ReportReason, note: string) => void;
  onBlock: () => void;
  onRate: (value: 1 | -1) => void;
  onNewGame: () => void;
  friendState: FriendState;
  friendConversationId: string | null;
  onAddFriend: () => void;
  onAcceptFriend: () => void;
}

function formatClock(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function pinnedLabel(
  entry: ChatStart['pinned'][number],
  { me, match, winnerId }: Pick<ChatScreenProps, 'me' | 'match' | 'winnerId'>,
) {
  if (entry.byUserId === null) return 'Sistem kartı';
  const name = entry.byUserId === me.id ? me.nickname : match.opponent.nickname;
  const isJoker = winnerId !== null && entry.byUserId !== winnerId;
  return isJoker ? `${name} jokeri` : `${name} soruyor`;
}

function endMessage(ended: ChatEndReason, leftByMe: boolean, opponent: string) {
  if (ended === 'timeout') return 'Süre doldu.';
  if (leftByMe) return 'Sohbetten ayrıldın.';
  return ended === 'left' ? `${opponent} sohbetten ayrıldı.` : `${opponent} bağlantısı koptu.`;
}

function ReportDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (reason: ReportReason, note: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>('taciz');
  const [note, setNote] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl bg-cream p-4 text-left shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(reason, note);
        }}
      >
        <h2 id="report-title" className="text-lg font-bold">
          Raporla
        </h2>
        <p className="mt-1 text-xs text-muted">Son 50 mesaj inceleme için ekibimizle paylaşılır.</p>
        <fieldset className="mt-2">
          <legend className="sr-only">Rapor nedeni</legend>
          {REPORT_OPTIONS.map((option) => (
            <label key={option.value} className="flex min-h-touch items-center gap-2 text-sm">
              <input
                type="radio"
                name="reason"
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        <label className="mt-2 block text-sm">
          Not (isteğe bağlı)
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={300}
            rows={2}
            className="mt-1 w-full rounded-lg border-2 border-ink/20 bg-white p-2"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-touch rounded-xl border-2 border-ink font-semibold"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            className="min-h-touch rounded-xl bg-danger font-semibold text-white"
          >
            Gönder
          </button>
        </div>
      </form>
    </div>
  );
}

export function ChatScreen(props: ChatScreenProps) {
  const {
    me,
    match,
    pinned,
    deadline,
    messages,
    opponentTyping,
    ended,
    leftByMe,
    notice,
    noticeIsError,
    refusedCount,
    reported,
    blocked,
    onSend,
    onTyping,
    onLeave,
    onReport,
    onBlock,
    onRate,
    onNewGame,
    friendState,
    friendConversationId,
    onAddFriend,
    onAcceptFriend,
  } = props;
  const [draft, setDraft] = useState('');
  const [remaining, setRemaining] = useState(() =>
    deadline === null ? Number.POSITIVE_INFINITY : Math.max(0, deadline - Date.now()),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef('');

  useEffect(() => {
    if (ended || deadline === null) return;
    const update = () => setRemaining(Math.max(0, deadline - Date.now()));
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [deadline, ended]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, opponentTyping, ended]);

  useEffect(() => {
    if (refusedCount > 0) setDraft((current) => current || lastSentRef.current);
  }, [refusedCount]);

  const warning = !ended && remaining <= WARNING_MS;
  const inputClosed = ended !== null || remaining <= 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || inputClosed) return;
    lastSentRef.current = body;
    onSend(body);
    setDraft('');
  };

  const rate = (value: 1 | -1) => {
    if (rating !== null) return;
    setRating(value);
    onRate(value);
  };

  const friendAction = (variant: 'inline' | 'panel') => {
    const className =
      variant === 'inline'
        ? 'inline-flex min-h-touch items-center px-1 font-bold underline'
        : 'flex min-h-touch items-center justify-center rounded-xl border-2 border-ink px-2 text-center text-sm font-semibold';
    if (friendState === 'friends') {
      return friendConversationId ? (
        <Link href={`/messages/${friendConversationId}`} className={className}>
          Arkadaşsınız ✓ Mesaj at
        </Link>
      ) : (
        <span className={className}>Arkadaşsınız ✓</span>
      );
    }
    if (friendState === 'sent') return <span className={className}>İstek gönderildi ✓</span>;
    if (friendState === 'incoming') {
      return (
        <button type="button" onClick={onAcceptFriend} className={className}>
          {match.opponent.nickname} seni eklemek istiyor → Kabul et
        </button>
      );
    }
    return (
      <button type="button" onClick={onAddFriend} className={className}>
        Arkadaş ekle
      </button>
    );
  };

  const menuItem = 'flex min-h-touch w-full items-center px-4 text-left text-sm font-semibold';

  return (
    <div className="flex h-dvh w-full flex-col text-left">
      <header className="relative flex items-center gap-2 border-b border-ink/10 py-2">
        <Avatar id={match.opponent.avatarId} size={40} />
        <p className="min-w-0 flex-1 truncate font-semibold">{match.opponent.nickname}</p>
        {!ended && deadline !== null && (
          <span
            role="timer"
            aria-label="Kalan süre"
            className={`font-mono text-lg font-bold ${warning ? 'text-danger' : ''}`}
          >
            {formatClock(remaining)}
          </span>
        )}
        <button
          type="button"
          aria-label="Sohbet menüsü"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex min-h-touch min-w-touch items-center justify-center rounded-full text-xl"
        >
          ⋮
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-40 w-48 overflow-hidden rounded-xl border border-ink/10 bg-white shadow-lg">
            {friendState === 'none' && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onAddFriend();
                }}
              >
                Arkadaş ekle
              </button>
            )}
            <button
              type="button"
              disabled={reported}
              className={`${menuItem} disabled:opacity-50`}
              onClick={() => {
                setMenuOpen(false);
                setReporting(true);
              }}
            >
              {reported ? 'Raporlandı ✓' : 'Raporla'}
            </button>
            <button
              type="button"
              disabled={blocked}
              className={`${menuItem} text-danger disabled:opacity-50`}
              onClick={() => {
                setMenuOpen(false);
                onBlock();
              }}
            >
              {blocked ? 'Engellendi ✓' : 'Engelle'}
            </button>
            {!ended && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onLeave();
                }}
              >
                Sohbetten çık
              </button>
            )}
          </div>
        )}
      </header>

      {pinned.length > 0 && (
        <ul
          aria-label="Seçilen kartlar"
          className="max-h-32 space-y-1 overflow-y-auto border-b border-ink/10 py-2 text-xs"
        >
          {pinned.map((entry) => (
            <li key={entry.card.id}>
              <strong>{pinnedLabel(entry, props)}:</strong> {entry.card.text}
            </li>
          ))}
        </ul>
      )}

      {warning && (
        <p
          role="status"
          className="bg-danger/10 px-2 py-1 text-center text-xs font-semibold text-danger"
        >
          Süre bitiyor — sohbet devam etsin mi? {friendAction('inline')}
        </p>
      )}

      {!warning && !ended && friendState === 'incoming' && (
        <p role="status" className="bg-accent/10 px-2 text-center text-xs font-semibold">
          {friendAction('inline')}
        </p>
      )}

      <div ref={listRef} aria-live="polite" className="flex-1 space-y-2 overflow-y-auto py-3">
        {messages.map((message) => {
          const mine = message.senderId === me.id;
          return (
            <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <p
                className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                  mine ? 'bg-ink text-cream' : 'border border-ink/10 bg-white'
                }`}
              >
                {message.body}
              </p>
            </div>
          );
        })}
        {opponentTyping && !ended && <p className="text-xs text-muted">Yazıyor…</p>}
      </div>

      {notice && (
        <p
          role={noticeIsError ? 'alert' : 'status'}
          className={`py-1 text-center text-xs font-semibold ${
            noticeIsError ? 'text-danger' : 'text-success'
          }`}
        >
          {notice}
        </p>
      )}

      {ended ? (
        <section aria-label="Sohbet sonu" className="space-y-2 border-t border-ink/10 py-3">
          <p className="text-center text-sm font-semibold">
            {endMessage(ended, leftByMe, match.opponent.nickname)}
          </p>
          <div className="flex items-center justify-center gap-2">
            <span className="text-sm text-muted">Sohbet nasıldı?</span>
            {([1, -1] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-label={value === 1 ? 'İyiydi' : 'Kötüydü'}
                aria-pressed={rating === value}
                disabled={rating !== null}
                onClick={() => rate(value)}
                className={`flex min-h-touch min-w-touch items-center justify-center rounded-full text-xl ${
                  rating === value ? 'bg-ink/10' : ''
                } ${rating !== null && rating !== value ? 'opacity-40' : ''}`}
              >
                {value === 1 ? '👍' : '👎'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {friendAction('panel')}
            <button
              type="button"
              onClick={onNewGame}
              className="min-h-touch rounded-xl bg-accent px-2 font-semibold text-white"
            >
              Yeni oyun
            </button>
          </div>
          <Link href="/" className="flex min-h-touch items-center justify-center text-sm underline">
            Ana sayfaya dön
          </Link>
        </section>
      ) : (
        <form onSubmit={submit} className="flex items-end gap-2 border-t border-ink/10 py-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Mesajın</span>
            <input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (event.target.value) onTyping();
              }}
              maxLength={MAX_MESSAGE_LENGTH}
              disabled={inputClosed}
              autoComplete="off"
              placeholder="Mesaj yaz…"
              className="h-11 w-full rounded-xl border-2 border-ink/20 bg-white px-3 text-base outline-none focus:border-ink"
            />
          </label>
          <button
            type="submit"
            disabled={inputClosed || !draft.trim()}
            className="min-h-touch rounded-xl bg-accent px-4 font-semibold text-white disabled:opacity-50"
          >
            Gönder
          </button>
        </form>
      )}

      {reporting && (
        <ReportDialog
          onClose={() => setReporting(false)}
          onSubmit={(reason, note) => {
            setReporting(false);
            onReport(reason, note);
          }}
        />
      )}
    </div>
  );
}
