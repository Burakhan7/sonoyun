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
}
