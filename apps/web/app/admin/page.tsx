import type { Metadata } from 'next';
import { ChatsClient } from '@/components/admin/ChatsClient';

export const metadata: Metadata = {
  title: 'Yönetim · Sohbetler',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <ChatsClient />;
}
