import type { LayoutDefinition } from './layout-editor/types';

const KEY_PREFIX = 'fluxus:page:';

export interface SlotPlacement {
  component: string;
  props: Record<string, unknown>;
}

export interface PageComponentEntry {
  name: string;
  version: string;
}

export interface PageFile {
  template?: string;
  layout?: LayoutDefinition;
  componentDependencies?: PageComponentEntry[];
  slots: Record<string, SlotPlacement | null>;
}

export function savePageLayout(path: string, layout: LayoutDefinition): void {
  const existing = loadPage(path) ?? { slots: {} };
  savePage(path, { ...existing, layout });
}

export function loadPageComponents(path: string): PageComponentEntry[] {
  return loadPage(path)?.componentDependencies ?? [];
}

export function savePageComponents(path: string, components: PageComponentEntry[]): void {
  const existing = loadPage(path) ?? { slots: {} };
  savePage(path, { ...existing, componentDependencies: components });
}

export function loadPageLayout(path: string): LayoutDefinition | null {
  return loadPage(path)?.layout ?? null;
}

export function savePage(path: string, definition: PageFile): void {
  localStorage.setItem(`${KEY_PREFIX}${path}`, JSON.stringify(definition));
}

export function loadPage(path: string): PageFile | null {
  const raw = localStorage.getItem(`${KEY_PREFIX}${path}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PageFile;
  } catch {
    return null;
  }
}

export function listPagePaths(): string[] {
  const paths: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) {
      paths.push(key.slice(KEY_PREFIX.length));
    }
  }
  return paths.sort();
}

export function deletePage(path: string): void {
  localStorage.removeItem(`${KEY_PREFIX}${path}`);
}

export function pageExists(path: string): boolean {
  return localStorage.getItem(`${KEY_PREFIX}${path}`) !== null;
}
