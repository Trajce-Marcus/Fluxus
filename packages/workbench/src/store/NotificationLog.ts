// The workbench's sink for `services.notify.*` — where the notify module lands
// its messages so the engine's service manifest validates.
//
// **Dormant** (M15 onward): hooks run server-side, so their notify calls go to
// the server's sink, not here. The workbench builds one of these per engine and
// never reads it back — no workbench surface lists notifications. It stays
// wired so the manifest stays complete and the DSL keeps type-checking.
//
// The Runtime app has its own copy behind its shell bell
// (`@fluxus/runtime` src/store/NotificationLog.ts), which *is* read: the two
// were one file while the workbench lived inside the Runtime app, and split at
// the package extraction because they are different things — a dormant stub
// here, a live shell feature there. The unified-log design (pipeline-as-log)
// replaces both with a server-side log; neither is worth sharing until then.

export interface NotificationEntry {
  id: string;
  /** 'user' (in-app) | 'email' — which notify function produced it. */
  channel: string;
  message: string;
  /** Only for channels with an address (email). */
  to?: string;
  subject?: string;
  timestamp: string;
}

// Key unchanged from the pre-extraction file on purpose: renaming it is a
// storage change, not a package move. Stale `sdm` segment stays until the
// unified log makes the whole class redundant.
const STORAGE_KEY = 'fluxus:sdm:notifications';
const MAX_ENTRIES = 200;

export class NotificationLog {
  private entries: NotificationEntry[];
  private listeners: Set<() => void> = new Set();
  private counter = 0;

  constructor() {
    try {
      this.entries = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    } catch {
      this.entries = [];
    }
  }

  append(entry: Omit<NotificationEntry, 'id' | 'timestamp'>): NotificationEntry {
    const full: NotificationEntry = {
      ...entry,
      id: `n_${Date.now()}_${this.counter++}`,
      timestamp: new Date().toISOString(),
    };
    this.entries = [...this.entries, full].slice(-MAX_ENTRIES);
    this.save();
    this.listeners.forEach((fn) => fn());
    return full;
  }

  /** Newest first. */
  list(): NotificationEntry[] {
    return [...this.entries].reverse();
  }

  clear(): void {
    this.entries = [];
    this.save();
    this.listeners.forEach((fn) => fn());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // quota exceeded or private browsing — silent
    }
  }
}
