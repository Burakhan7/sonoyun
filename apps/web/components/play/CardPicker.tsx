'use client';

import { useEffect, useState } from 'react';
import type { CardsOffer, MatchFound, PublicCard, PublicUser, ServerEventPayload } from 'shared';

const LEVELS: Record<PublicCard['level'], { dot: string; label: string }> = {
  light: { dot: '🟢', label: 'Hafif' },
  personal: { dot: '🟡', label: 'Kişisel' },
  bold: { dot: '🔴', label: 'Cesaret' },
};

interface CardPickerProps {
  me: PublicUser;
  match: MatchFound;
  result: ServerEventPayload<'game:over'>;
  offer: CardsOffer;
  deadline: number;
  onPick: (cardIds: string[]) => void;
}

function headline({ me, match, result }: Pick<CardPickerProps, 'me' | 'match' | 'result'>) {
  if (result.winnerId === null) return '🤝 Berabere!';
  const name = result.winnerId === me.id ? me.nickname : match.opponent.nickname;
  return `🏆 ${name} kazandı!`;
}

function instruction(result: CardPickerProps['result'], myId: string, pickCount: number) {
  if (result.winnerId === null) return '1 kart seç, sistem de 1 kart ekleyecek.';
  return result.winnerId === myId ? `Sohbet için ${pickCount} kart seç.` : '1 joker kart seç.';
}

export function CardPicker({ me, match, result, offer, deadline, onPick }: CardPickerProps) {
  const [selected, setSelected] = useState<string[]>(offer.picked);
  const [sent, setSent] = useState(offer.picked.length > 0);
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, deadline - Date.now()));
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [deadline]);

  const toggle = (id: string) => {
    if (sent) return;
    setSelected((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (offer.pickCount === 1) return [id];
      return current.length < offer.pickCount ? [...current, id] : current;
    });
  };

  const confirm = () => {
    if (sent || selected.length !== offer.pickCount) return;
    setSent(true);
    onPick(selected);
  };

  return (
    <div className="flex w-full flex-col gap-3 py-4">
      <header>
        <h1 className="text-xl font-bold">{headline({ me, match, result })}</h1>
        <p className="text-sm text-muted">
          {me.nickname} {result.scores[me.id] ?? 0} – {result.scores[match.opponent.id] ?? 0}{' '}
          {match.opponent.nickname}
        </p>
        {result.harmony !== undefined && (
          <p className="text-sm font-semibold">Uyumunuz: %{result.harmony}</p>
        )}
      </header>

      <div className="flex items-center justify-between gap-2 text-sm font-semibold">
        <span>{sent ? 'Kartlar seçiliyor…' : instruction(result, me.id, offer.pickCount)}</span>
        <span role="timer" className={`shrink-0 ${remaining <= 5000 ? 'text-danger' : ''}`}>
          {Math.ceil(remaining / 1000)} sn
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {offer.cards.map((card) => {
          const isSelected = selected.includes(card.id);
          return (
            <li key={card.id}>
              <button
                type="button"
                disabled={sent}
                aria-pressed={isSelected}
                onClick={() => toggle(card.id)}
                className={`flex min-h-touch w-full items-start gap-2 rounded-xl border-2 p-3 text-left text-sm transition-colors ${
                  isSelected ? 'border-ink bg-ink text-cream' : 'border-ink/20 bg-white'
                } ${sent && !isSelected ? 'opacity-50' : ''}`}
              >
                <span role="img" aria-label={LEVELS[card.level].label} className="shrink-0">
                  {LEVELS[card.level].dot}
                </span>
                <span>{card.text}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {sent ? (
        <p role="status" className="text-sm text-muted">
          Seçimin kaydedildi, rakip bekleniyor…
        </p>
      ) : (
        <button
          type="button"
          onClick={confirm}
          disabled={selected.length !== offer.pickCount}
          className="flex min-h-touch w-full items-center justify-center rounded-xl bg-accent px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          Seç ({selected.length}/{offer.pickCount})
        </button>
      )}
    </div>
  );
}
