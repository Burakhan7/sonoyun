import type { Metadata } from 'next';
import { AdminClient } from '@/components/admin/AdminClient';

export const metadata: Metadata = {
  title: 'Yönetim · Raporlar',
  robots: { index: false, follow: false },
};

export default function AdminReportsPage() {
  return <AdminClient />;
}
