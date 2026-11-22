'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { MatchFound, PublicUser, ServerEventPayload } from 'shared';
import { Avatar } from '@/components/Avatar';

export type RoundStart = ServerEventPayload<'round:start'>;
export type RoundResult = ServerEventPayload<'round:result'>;
export type AnswerPayload = { answer: string | number; prediction?: 'a' | 'b' };

interface GameScreenProps {
  me: PublicUser;
  match: MatchFound;
  round: RoundStart;
  result: RoundResult | null;
  /** Local timestamp at which this round's timer reaches zero. */
  deadline: number;
  onAnswer: (payload: AnswerPayload) => void;
}

const TIMER_RADIUS = 20;
const TIMER_LENGTH = 2 * Math.PI * TIMER_RADIUS;

const answerBase =
  'flex min-h-[56px] w-full items-center justify-center rounded-xl border-2 px-3 py-2 text-center font-semibold transition-colors';

function RoundTimer({
  deadline,
  total,
  stopped,
}: {
  deadline: number;
  total: number;
  stopped: boolean;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    if (stopped) return;
    const update = () => setRemaining(Math.max(0, deadline - Date.now()));
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [deadline, stopped]);

  const fraction = total > 0 ? Math.min(1, remaining / total) : 0;
  const urgent = remaining <= 3000;

  return (
    <div
      role="timer"
      aria-label={`${Math.ceil(remaining / 1000)} saniye kaldı`}
      className="relative h-12 w-12 shrink-0"
    >
      <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
        <circle
          cx="24"
          cy="24"
          r={TIMER_RADIUS}
          fill="none"
          strokeWidth="4"
          className="stroke-ink/10"
        />
        <circle
          cx="24"
          cy="24"
          r={TIMER_RADIUS}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={TIMER_LENGTH}
          strokeDashoffset={TIMER_LENGTH * (1 - fraction)}
          className={urgent ? 'stroke-danger' : 'stroke-accent'}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${urgent ? 'text-danger' : ''}`}
      >
        {Math.ceil(remaining / 1000)}
      </span>
    </div>
  );
}

function PlayerScore({
  avatarId,
  nickname,
  score,
  alignEnd,
}: {
  avatarId: PublicUser['avatarId'];
  nickname: string;
  score: number;
  alignEnd?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 ${alignEnd ? 'flex-row-reverse text-right' : ''}`}
    >
      <Avatar id={avatarId} size={36} />
      <div className="min-w-0">
        <p className="truncate text-xs text-muted">{nickname}</p>
        <p className="text-lg font-bold leading-tight">{score}</p>
      </div>
    </div>
  );
}

function optionClass(index: number, picked: number | null, correct: number | null) {
  if (correct !== null) {
    if (index === correct) return 'border-success bg-success text-white';
    if (index === picked) return 'border-danger bg-danger text-white';
    return 'border-ink/10 bg-white text-muted';
  }
  if (index === picked) return 'border-ink bg-ink text-cream';
  return 'border-ink/20 bg-white active:bg-ink/5';
}

function ChoiceAnswers({
  options,
  picked,
  correct,
  disabled,
  onPick,
}: {
  options: readonly string[];
  picked: number | null;
  correct: number | null;
  disabled: boolean;
  onPick: (index: number) => void;
}) {
  return (
    <div className="grid w-full grid-cols-1 gap-2">
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          aria-pressed={picked === index}
          onClick={() => onPick(index)}
          className={`${answerBase} ${optionClass(index, picked, correct)}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function EstimateAnswer({
  unit,
  disabled,
  onSubmit,
}: {
  unit: string;
  disabled: boolean;
  onSubmit: (value: number) => void;
}) {
  const [value, setValue] = useState('');
  const parsed = Number(value.trim().replace(',', '.'));
  const valid = value.trim() !== '' && Number.isFinite(parsed);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && !disabled) onSubmit(parsed);
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2">
      <label className="flex min-h-[56px] items-center gap-2 rounded-xl border-2 border-ink/20 bg-white px-3">
        <span className="sr-only">Tahminin</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          placeholder="Tahminin"
          className="h-12 min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
        />
        <span className="shrink-0 text-sm text-muted">{unit}</span>
      </label>
      <button
        type="submit"
        disabled={disabled || !valid}
        className={`${answerBase} border-accent bg-accent text-white disabled:opacity-50`}
      >
        Gönder
      </button>
    </form>
  );
}

function AynaAnswer({
  a,
  b,
  disabled,
  onSubmit,
}: {
  a: string;
  b: string;
  disabled: boolean;
  onSubmit: (answer: 'a' | 'b', prediction: 'a' | 'b') => void;
}) {
  const [choice, setChoice] = useState<'a' | 'b' | null>(null);
  const keys = ['a', 'b'] as const;
  const labels = { a, b };

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-center text-sm font-semibold">
        {choice ? 'Rakibin hangisini seçti sence?' : 'Sen hangisini seçersin?'}
      </p>
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (choice) onSubmit(choice, key);
            else setChoice(key);
          }}
          className={`${answerBase} border-ink/20 bg-white active:bg-ink/5`}
        >
          {labels[key]}
        </button>
      ))}
      {choice && <p className="text-center text-xs text-muted">Senin seçimin: {labels[choice]}</p>}
    </div>
  );
}

function resultMessage(round: RoundStart, result: RoundResult, myId: string) {
  const mine = result.answers[myId];
  const { question } = round;
  if (question.type === 'ayna') {
    return mine?.isCorrect ? 'Rakibini doğru tahmin ettin! +1' : 'Bu sefer tahmin tutmadı.';
  }
  const gained = mine?.points ? ` +${mine.points}` : '';
  if (question.type === 'estimate') {
    const answer = Number(result.correct).toLocaleString('tr-TR');
    return `Doğru cevap: ${answer} ${question.unit}${gained}`;
  }
  if (question.type === 'tf') {
    return `Doğru cevap: ${result.correct ? 'Doğru' : 'Yanlış'}${gained}`;
  }
  if (mine?.answer === null || mine?.answer === undefined) return 'Süre doldu.';
  return mine.isCorrect ? `Doğru!${gained}` : 'Yanlış cevap.';
}

export function GameScreen({ me, match, round, result, deadline, onAnswer }: GameScreenProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const [locked, setLocked] = useState(round.answered);
  const [expired, setExpired] = useState(false);
  const scores = result?.scores ?? round.scores;
  const { question } = round;
  const totalMs = Math.max(round.remainingMs, 1);
  const inputDisabled = locked || expired || result !== null;

  useEffect(() => {
    const delay = Math.max(0, deadline - Date.now());
    const timeout = window.setTimeout(() => setExpired(true), delay);
    return () => window.clearTimeout(timeout);
  }, [deadline]);

  const submit = (payload: AnswerPayload) => {
    if (inputDisabled) return;
    setLocked(true);
    onAnswer(payload);
  };

  const pickOption = (index: number) => {
    if (inputDisabled) return;
    setPicked(index);
    submit({ answer: index });
  };

  const tfCorrect = result && typeof result.correct === 'boolean' ? (result.correct ? 0 : 1) : null;
  const choiceCorrect = result && typeof result.correct === 'number' ? result.correct : null;

  return (
    <div className="flex min-h-dvh w-full flex-col gap-3 py-3">
      <header className="flex items-center gap-2">
        <PlayerScore avatarId={me.avatarId} nickname={me.nickname} score={scores[me.id] ?? 0} />
        <RoundTimer deadline={deadline} total={totalMs} stopped={result !== null} />
        <PlayerScore
          avatarId={match.opponent.avatarId}
          nickname={match.opponent.nickname}
          score={scores[match.opponent.id] ?? 0}
          alignEnd
        />
      </header>

      <p className="text-center text-xs font-semibold text-muted">
        Tur {round.roundNo}/{round.total}
      </p>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        {question.type === 'emoji' && (
          <p className="break-words text-5xl leading-tight">{question.emoji}</p>
        )}
        {question.type === 'ayna' ? (
          <h1 className="text-xl font-bold">Bu mu, şu mu?</h1>
        ) : (
          <h1 className="text-xl font-bold">{question.prompt}</h1>
        )}
        <div aria-live="polite" className="min-h-6 text-sm font-semibold">
          {result
            ? resultMessage(round, result, me.id)
            : locked
              ? 'Cevabın kilitlendi, rakip bekleniyor…'
              : expired
                ? 'Süre doldu.'
                : ''}
        </div>
      </section>

      <section aria-label="Cevaplar" className="w-full">
        {(question.type === 'mc' || question.type === 'emoji') && (
          <ChoiceAnswers
            options={question.options}
            picked={picked}
            correct={choiceCorrect}
            disabled={inputDisabled}
            onPick={pickOption}
          />
        )}
        {question.type === 'tf' && (
          <div className="grid grid-cols-2 gap-2">
            {(['Doğru', 'Yanlış'] as const).map((label, index) => (
              <button
                key={label}
                type="button"
                disabled={inputDisabled}
                aria-pressed={picked === index}
                onClick={() => {
                  if (inputDisabled) return;
                  setPicked(index);
                  submit({ answer: index === 0 ? 1 : 0 });
                }}
                className={`${answerBase} ${optionClass(index, picked, tfCorrect)}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {question.type === 'estimate' && (
          <EstimateAnswer
            unit={question.unit}
            disabled={inputDisabled}
            onSubmit={(value) => submit({ answer: value })}
          />
        )}
        {question.type === 'ayna' && (
          <AynaAnswer
            a={question.a}
            b={question.b}
            disabled={inputDisabled}
            onSubmit={(answer, prediction) => submit({ answer, prediction })}
          />
        )}
      </section>
    </div>
  );
}
