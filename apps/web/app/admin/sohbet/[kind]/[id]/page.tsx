import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ADMIN_CHAT_KINDS, type AdminChatKind } from 'shared';
import { ChatClient } from '@/components/admin/ChatClient';

export const metadata: Metadata = {
  title: 'Yönetim · Sohbet',
  robots: { index: false, follow: false },
};

export default async function AdminChatPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (!ADMIN_CHAT_KINDS.includes(kind as AdminChatKind) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    notFound();
  }
  return <ChatClient kind={kind as AdminChatKind} id={id} />;
}
