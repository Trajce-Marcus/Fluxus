// Workbench notification store — where the notify service module lands its
// messages. Same persist/subscribe pattern as the record adapter.

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
