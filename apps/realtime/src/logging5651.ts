import type { PrismaClient } from '@prisma/client';

export type AccessEvent = 'connect' | 'disconnect' | 'match' | 'message';

export interface AccessEntry {
  userId: string | null;
  ip: string;
  port: number | null;
  event: AccessEvent;
  at: Date;
}

const FLUSH_SIZE = 200;
const MAX_BUFFER = 50_000;

/**
 * Buffers 5651 traffic records and writes them in batches. Records hold connection metadata only,
 * never message content. Retention is a legal decision (SPEC §15), so nothing here deletes them.
 */
export class AccessLogger {
  private buffer: AccessEntry[] = [];
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly prisma: Pick<PrismaClient, 'accessLog'>,
    private readonly onError: (error: unknown) => void,
  ) {}

  record(entry: Omit<AccessEntry, 'at'>, at = new Date()) {
    if (this.buffer.length >= MAX_BUFFER) {
      this.onError(new Error('Access log buffer is full; dropping the oldest record'));
      this.buffer.shift();
    }
    this.buffer.push({ ...entry, at });
    if (this.buffer.length >= FLUSH_SIZE) void this.flush();
  }

  /** Writes buffered records. Failed batches stay in the buffer for the next attempt. */
  flush(): Promise<void> {
    this.flushing ??= this.writeAll().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async writeAll() {
    while (this.buffer.length > 0) {
      const batch = this.buffer.slice(0, FLUSH_SIZE);
      try {
        await this.prisma.accessLog.createMany({ data: batch });
        this.buffer.splice(0, batch.length);
      } catch (error) {
        this.onError(error);
        return;
      }
    }
  }

  get pending() {
    return this.buffer.length;
  }
}
