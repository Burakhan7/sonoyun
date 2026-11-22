'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SOCKET_AUTH_ERRORS, onlineCountSchema, type OnlineCount, type PublicUser } from 'shared';
import {
  SessionExpiredError,
  acceptTerms,
  loadSession,
  refreshIdentity,
  resetSession,
} from '@/lib/session';
import { connectSocket } from '@/lib/socket';
import { Avatar } from './Avatar';
import { TermsModal } from './TermsModal';

const iconLinkClass =
  'flex min-h-touch min-w-touch items-center justify-center rounded-full text-xl hover:bg-ink/5';

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HomeHeader() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [stats, setStats] = useState<OnlineCount | null>(null);
  const [banned, setBanned] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptFailed, setAcceptFailed] = useState(false);
  const recoveredSession = useRef(false);

  const startSession = useCallback(async () => {
    setSessionFailed(false);
    try {
      const session = await loadSession();
      setUser(session.user);
      setToken(session.token);
      setBanned(session.user.bannedUntil !== null);
    } catch {
      setSessionFailed(true);
    }
  }, []);

  const restartSession = useCallback(async () => {
    resetSession();
    await startSession();
  }, [startSession]);

  useEffect(() => {
    void startSession();
  }, [startSession]);

  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);

    const onCount = (payload: OnlineCount) => {
      const parsed = onlineCountSchema.safeParse(payload);
      if (parsed.success) setStats(parsed.data);
    };
    const onDisconnect = () => setStats(null);
    const onConnectError = (error: Error) => {
      if (error.message === SOCKET_AUTH_ERRORS.banned) {
        setBanned(true);
      } else if (error.message === SOCKET_AUTH_ERRORS.unauthorized && !recoveredSession.current) {
        recoveredSession.current = true;
        void restartSession();
      }
    };

    socket.on('online:count', onCount);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    return () => {
      socket.off('online:count', onCount);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, [token, restartSession]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    try {
      const result = await refreshIdentity();
      if (result.status === 'updated') setUser(result.user);
      else
        setNotice(`Yeniden ${formatDateTime(result.nextRefreshAt)} itibarıyla değiştirebilirsin.`);
    } catch (error) {
      if (error instanceof SessionExpiredError) await restartSession();
      else setNotice('Takma ad yenilenemedi. Lütfen tekrar dene.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAccept = async () => {
    setAccepting(true);
    setAcceptFailed(false);
    try {
      setUser(await acceptTerms());
    } catch (error) {
      if (error instanceof SessionExpiredError) await restartSession();
      else setAcceptFailed(true);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <header className="w-full">
      <div className="flex items-center justify-between gap-2">
        {user ? (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label={`${user.nickname}, takma adı yenile`}
            className="flex min-h-touch min-w-0 items-center gap-2 rounded-full pr-2 text-left disabled:opacity-60"
          >
            <Avatar id={user.avatarId} size={44} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{user.nickname}</span>
              <span className="block text-xs text-muted">Yenilemek için dokun</span>
            </span>
          </button>
        ) : (
          <div className="flex min-h-touch items-center text-sm text-muted">
            {sessionFailed ? (
              <button type="button" onClick={startSession} className="min-h-touch underline">
                Bağlanılamadı, tekrar dene
              </button>
            ) : (
              'Yükleniyor…'
            )}
          </div>
        )}
        <nav aria-label="Hesap" className="flex shrink-0 items-center">
          <Link href="/friends" aria-label="Arkadaşlar" className={iconLinkClass}>
            👥
          </Link>
          <Link href="/messages" aria-label="Mesajlar" className={iconLinkClass}>
            💬
          </Link>
        </nav>
      </div>

      <p aria-live="polite" className="mt-2 text-center text-sm text-muted">
        {stats ? `🟢 ${stats.online.toLocaleString('tr-TR')} çevrimiçi` : 'Bağlanıyor…'}
      </p>
      {notice && (
        <p role="status" className="mt-1 text-center text-xs text-accent">
          {notice}
        </p>
      )}
      {banned && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-accent/10 p-2 text-center text-sm text-accent"
        >
          Hesabın geçici olarak kısıtlandı
          {user?.bannedUntil ? `: ${formatDateTime(user.bannedUntil)} tarihine kadar.` : '.'}
        </p>
      )}

      {user && !user.termsAccepted && (
        <TermsModal busy={accepting} failed={acceptFailed} onAccept={handleAccept} />
      )}
    </header>
  );
}
