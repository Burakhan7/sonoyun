'use client';

import { useCallback, useEffect, useState } from 'react';
import { ADMIN_REPORT_STATUSES, adminReportsResponseSchema, type AdminReport } from 'shared';
import { AdminNav, BAN_OPTIONS, button, formatDate, post } from './common';

type Status = (typeof ADMIN_REPORT_STATUSES)[number];

const STATUS_LABELS: Record<Status, string> = {
  open: 'Açık',
  resolved: 'Çözüldü',
  dismissed: 'Reddedildi',
};

const REASON_LABELS: Record<string, string> = {
  taciz: 'Taciz',
  kufur: 'Küfür',
  spam: 'Spam',
  'reşit-olmayan': 'Reşit olmayan şüphesi',
  diger: 'Diğer',
};

function ReportCard({
  report,
  onChanged,
  onError,
}: {
  report: AdminReport;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(report.priority);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const { reported, reporter } = report;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch {
      onError('İşlem başarısız oldu.');
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (senderId: string) => {
    if (senderId === reported.id) return reported.nickname ?? 'Raporlanan';
    if (senderId === reporter.id) return reporter.nickname ?? 'Raporlayan';
    return senderId;
  };

  return (
    <li
      className={`rounded-xl border-2 bg-white p-3 ${report.priority ? 'border-danger' : 'border-ink/10'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {report.priority && (
          <span className="rounded bg-danger px-2 py-0.5 text-xs font-bold text-white">
            ÖNCELİKLİ
          </span>
        )}
        <strong>{REASON_LABELS[report.reason] ?? report.reason}</strong>
        <span className="text-xs text-muted">{formatDate(report.createdAt)}</span>
      </div>

      <dl className="mt-2 space-y-1 text-sm">
        <div>
          <dt className="inline font-semibold">Raporlanan: </dt>
          <dd className="inline break-all">
            {reported.nickname ?? 'Silinmiş hesap'} ({reported.openReports} açık rapor)
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">Raporlayan: </dt>
          <dd className="inline">{reporter.nickname ?? 'Silinmiş hesap'}</dd>
        </div>
        {reported.bannedUntil && (
          <p className="font-semibold text-danger">Banlı: {formatDate(reported.bannedUntil)}</p>
        )}
        {reported.suspended && (
          <p className="font-semibold text-danger">Otomatik 24 saat eşleşme kısıtında</p>
        )}
        {report.note && (
          <div>
            <dt className="inline font-semibold">Not: </dt>
            <dd className="inline whitespace-pre-wrap break-words">{report.note}</dd>
          </div>
        )}
      </dl>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`${button} mt-2 bg-ink/5`}
      >
        Mesajlar ({report.snapshot.length})
      </button>
      {open && (
        <ol className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-lg bg-cream p-2 text-sm">
          {report.snapshot.length === 0 && <li className="text-muted">Mesaj yok.</li>}
          {report.snapshot.map((message) => (
            <li key={message.id} className="whitespace-pre-wrap break-words">
              <strong>{nameOf(message.senderId)}:</strong> {message.body}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {reported.nickname !== null && (
          <>
            <label className="text-sm">
              <span className="sr-only">Ban süresi</span>
              <select
                value={hours}
                onChange={(event) => setHours(Number(event.target.value))}
                className="min-h-touch rounded-lg border-2 border-ink/20 bg-white px-2"
              >
                {BAN_OPTIONS.map((option) => (
                  <option key={option.hours} value={option.hours}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => post(`users/${reported.id}/ban`, { hours }))}
              className={`${button} bg-danger text-white`}
            >
              Banla
            </button>
            {(reported.bannedUntil || reported.suspended) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => post(`users/${reported.id}/unban`))}
                className={`${button} bg-ink/5`}
              >
                Kısıtları kaldır
              </button>
            )}
          </>
        )}
        {report.status === 'open' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => post(`reports/${report.id}/status`, { status: 'resolved' }))}
              className={`${button} bg-success text-white`}
            >
              Çözüldü
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() => post(`reports/${report.id}/status`, { status: 'dismissed' }))
              }
              className={`${button} bg-ink/5`}
            >
              Reddet
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function AdminClient() {
  const [status, setStatus] = useState<Status>('open');
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/reports?status=${status}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Load failed');
      setReports(adminReportsResponseSchema.parse(await response.json()).reports);
      setError(null);
    } catch {
      setError('Raporlar yüklenemedi.');
    }
  }, [status]);

  useEffect(() => {
    setReports(null);
    void load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Raporlar</h1>
        <AdminNav />
      </div>
      <div role="tablist" className="mt-3 flex gap-2">
        {ADMIN_REPORT_STATUSES.map((item) => (
          <button
            key={item}
            role="tab"
            type="button"
            aria-selected={status === item}
            onClick={() => setStatus(item)}
            className={`${button} ${status === item ? 'bg-ink text-cream' : 'bg-ink/5'}`}
          >
            {STATUS_LABELS[item]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 font-semibold text-danger">
          {error}
        </p>
      )}
      {!reports && !error && <p className="mt-4 text-muted">Yükleniyor…</p>}
      {reports?.length === 0 && <p className="mt-4 text-muted">Bu durumda rapor yok.</p>}
      <ul className="mt-4 space-y-3">
        {reports?.map((report) => (
          <ReportCard key={report.id} report={report} onChanged={load} onError={setError} />
        ))}
      </ul>
    </main>
  );
}
