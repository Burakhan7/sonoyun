'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AdminChatSummary } from 'shared';
import { Avatar } from '@/components/Avatar';

export const BAN_OPTIONS = [
  { hours: 24, label: '24 saat' },
  { hours: 24 * 7, label: '7 gün' },
  { hours: 24 * 30, label: '30 gün' },
  { hours: 24 * 365, label: '1 yıl' },
];

export const button = 'min-h-touch rounded-lg px-3 text-sm font-semibold disabled:opacity-50';

export const formatDate = (value: string) => new Date(value).toLocaleString('tr-TR');

export const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export function timeAgo(value: string, now: number) {
  const minutes = Math.floor((now - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  return `${Math.floor(minutes / 60)} sa önce`;
}

export function timeLeft(endsAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export async function post(path: string, body?: unknown) {
  const response = await fetch(`/api/admin/${path}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
}

type Party = AdminChatSummary['participants'][number];

export const partyName = (party: Party | undefined) => party?.nickname ?? 'Silinmiş hesap';

export function PartyAvatar({ party, size = 40 }: { party: Party | undefined; size?: number }) {
  if (party?.avatarId) return <Avatar id={party.avatarId} size={size} />;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-ink/10 text-muted"
      style={{ width: size, height: size }}
    >
      ?
    </span>
  );
}

export function chatLabel(chat: AdminChatSummary) {
  if (chat.kind === 'dm') return 'Özel mesaj';
  return chat.friendly ? 'Arkadaş oyunu' : 'Oyun sohbeti';
}

const LINKS = [
  { href: '/admin', label: 'Sohbetler' },
  { href: '/admin/raporlar', label: 'Raporlar' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Yönetim" className="flex gap-2">
      {LINKS.map((link) => {
        const current =
          link.href === '/admin'
            ? pathname === '/admin' || pathname.startsWith('/admin/sohbet')
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? 'page' : undefined}
            className={`${button} inline-flex items-center ${current ? 'bg-ink text-cream' : 'bg-ink/5'}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
