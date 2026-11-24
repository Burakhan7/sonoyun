import type { ModerationStore, NewReport } from '../moderation.js';
import type { MatchOutcome, MatchStore } from '../rooms.js';
import type { Identity, UserRecord, UserStore } from '../users.js';

export class MemoryUserStore implements UserStore {
  readonly records = new Map<string, UserRecord>();
  private nextId = 1;

  async create(identity: Identity) {
    const user: UserRecord = {
      id: `user-${this.nextId++}`,
      ...identity,
      acceptedTermsAt: null,
      nicknameChangedAt: null,
      bannedUntil: null,
    };
    this.records.set(user.id, user);
    return { ...user };
  }

  async findById(id: string) {
    const user = this.records.get(id);
    return user ? { ...user } : null;
  }

  async touch() {}

  async acceptTerms(id: string, now: Date) {
    const user = this.records.get(id);
    if (user && !user.acceptedTermsAt) user.acceptedTermsAt = now;
  }

  async recordDevice(id: string, deviceHash: string) {
    const user = this.records.get(id);
    if (user) user.deviceHash = deviceHash;
  }

  async refreshIdentity(id: string, identity: Identity, cutoff: Date, now: Date) {
    const user = this.records.get(id);
    if (!user || (user.nicknameChangedAt && user.nicknameChangedAt > cutoff)) return false;
    Object.assign(user, identity, { nicknameChangedAt: now });
    return true;
  }
}

export class MemoryMatchStore implements MatchStore {
  readonly created: Parameters<MatchStore['create']>[0][] = [];
  readonly ended = new Map<string, Date>();
  readonly outcomes = new Map<string, MatchOutcome | undefined>();
  readonly ratings = new Map<string, Record<string, number>>();
  failNextCreate = false;

  async create(match: Parameters<MatchStore['create']>[0]) {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('Match store failure');
    }
    this.created.push(match);
  }

  async end(id: string, endedAt: Date, outcome?: MatchOutcome) {
    this.outcomes.set(id, outcome);
    this.ended.set(id, endedAt);
  }

  async rate(id: string, userId: string, value: 1 | -1) {
    this.ratings.set(id, { ...this.ratings.get(id), [userId]: value });
  }
}

export class MemoryModerationStore implements ModerationStore {
  readonly reports: (NewReport & { createdAt: Date })[] = [];
  readonly blocks: [string, string][] = [];
  now = () => new Date();

  async createReport(report: NewReport) {
    this.reports.push({ ...report, createdAt: this.now() });
  }

  async countRecentReporters(reportedId: string, since: Date) {
    const recent = this.reports.filter(
      (report) => report.reportedId === reportedId && report.createdAt >= since,
    );
    return new Set(recent.map((report) => report.reporterId)).size;
  }

  async createBlock(blockerId: string, blockedId: string) {
    this.blocks.push([blockerId, blockedId]);
  }
}
