import Link from 'next/link';
import type { MatchFound, PublicUser, ServerEventPayload } from 'shared';
import { Avatar } from '@/components/Avatar';

interface GameOverProps {
  me: PublicUser;
  match: MatchFound;
  result: ServerEventPayload<'game:over'>;
  onNewGame: () => void;
}

function headline({ me, match, result }: GameOverProps) {
  if (result.winnerId === null) return '🤝 Berabere!';
  const name = result.winnerId === me.id ? me.nickname : match.opponent.nickname;
  return `🏆 ${name} kazandı!`;
}

export function GameOver(props: GameOverProps) {
  const { me, match, result, onNewGame } = props;

  return (
    <div className="flex w-full flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">{headline(props)}</h1>
        {result.forfeit && result.winnerId === me.id && (
          <p className="mt-1 text-sm text-muted">Rakibin bağlantısı koptu, hükmen kazandın.</p>
        )}
      </div>

      <div className="flex w-full items-center justify-center gap-6">
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <Avatar id={me.avatarId} size={64} />
          <p className="w-full truncate text-sm text-muted">{me.nickname}</p>
          <p className="text-3xl font-bold">{result.scores[me.id] ?? 0}</p>
        </div>
        <span aria-hidden="true" className="font-bold text-muted">
          –
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <Avatar id={match.opponent.avatarId} size={64} />
          <p className="w-full truncate text-sm text-muted">{match.opponent.nickname}</p>
          <p className="text-3xl font-bold">{result.scores[match.opponent.id] ?? 0}</p>
        </div>
      </div>

      {result.harmony !== undefined && <p className="font-semibold">Uyumunuz: %{result.harmony}</p>}

      <div className="flex w-full flex-col gap-3">
        <button
          type="button"
          onClick={onNewGame}
          className="flex min-h-touch w-full items-center justify-center rounded-xl bg-accent px-4 py-3 font-semibold text-white"
        >
          Yeni oyun
        </button>
        <Link href="/" className="flex min-h-touch items-center justify-center underline">
          Ana sayfaya dön
        </Link>
      </div>
    </div>
  );
}
