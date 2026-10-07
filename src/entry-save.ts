import type { Entry, EntryInput } from '../shared/schema';

export interface SaveResult {
  entry: Entry;
  version: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }

  get definitelyRejected() {
    // A timeout or server/transport failure may arrive after a successful commit.
    return this.status >= 400 && this.status < 500 && this.status !== 408;
  }
}

type Write = (
  input: EntryInput,
  entry: Entry | undefined,
  requestId: string,
) => Promise<SaveResult>;
type Pending = { input: EntryInput; entry: Entry | undefined; requestId: string };
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );

/** One open editor's logical record, including writes with an uncertain outcome. */
export class EntrySaver {
  private pending?: Pending;
  private confirmed?: { input: EntryInput; result: SaveResult };
  private inFlight?: Promise<SaveResult>;

  constructor(
    private write: Write,
    private current?: Entry,
  ) {}

  get hasPending() {
    return !!this.pending;
  }

  save(input: EntryInput): Promise<SaveResult> {
    if (this.inFlight) return this.inFlight;
    const task = this.saveNext(structuredClone(input));
    this.inFlight = task;
    void task.then(
      () => {
        this.inFlight = undefined;
      },
      () => {
        this.inFlight = undefined;
      },
    );
    return task;
  }

  private async saveNext(input: EntryInput): Promise<SaveResult> {
    // Resolve the original payload and key before considering any later edits.
    // A replay returns the original ID/version; the next write is a guarded update.
    if (this.pending) await this.commit();
    if (this.confirmed && canonical(this.confirmed.input) === canonical(input))
      return this.confirmed.result;
    this.pending = {
      input,
      entry: this.current ? structuredClone(this.current) : undefined,
      requestId: crypto.randomUUID(),
    };
    return this.commit();
  }

  private async commit(): Promise<SaveResult> {
    const pending = this.pending!;
    try {
      const result = await this.write(pending.input, pending.entry, pending.requestId);
      this.current = result.entry;
      this.confirmed = { input: pending.input, result };
      this.pending = undefined;
      return result;
    } catch (error) {
      // Validation/auth/conflict errors did not commit. A corrected draft can be
      // sent directly; uncertainty keeps its immutable payload and request key.
      if (error instanceof ApiError && error.definitelyRejected) this.pending = undefined;
      throw error;
    }
  }
}
