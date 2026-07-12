import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { pageContextStore, type PageContext } from './store/contextStore';
import { registry } from './components';
import { initSdmRuntime } from './sdm-runtime/engine';
import { ensureDemoPage } from './sdm-runtime/demoPage';

// THE entry point (index.html loads this module and mounts Shell) — so the
// SDM runtime bootstraps here: fetch the scope's config + partition from
// @fluxus/server before anything renders. Kicked off at module load; every
// mount awaits it. Hard cutover by ruling: server unreachable → error text in
// the mount element, no localStorage fallback. Demo-page seeding runs after
// init because savePage validates against the fetched config.
const sdmReady = initSdmRuntime().then(() => {
  ensureDemoPage();
});

type PropsMap = Record<string, unknown>;

interface ComponentEntry {
  name: string;
  elementId: string;
  props?: PropsMap;
}

interface PageContextApi extends PageContext {
  get(): PageContext;
  set(newValue: PageContext | ((prev: PageContext) => PageContext)): void;
}

interface MyComponentsApi {
  pageContext: PageContextApi;
  mount(name: string, el: Element, props?: PropsMap): void;
  load(components: ComponentEntry[]): void;
}

declare global {
  interface Window {
    MyComponents: MyComponentsApi;
  }
}

const pageContextApi = pageContextStore.proxy as PageContextApi;

// Non-enumerable so Object.keys() inside store.set() doesn't see them
// and they survive a full .set({...}) replace.
Object.defineProperty(pageContextApi, 'get', {
  value: pageContextStore.get,
  enumerable: false,
  configurable: true,
});
Object.defineProperty(pageContextApi, 'set', {
  value: pageContextStore.set,
  enumerable: false,
  configurable: true,
});

window.MyComponents = {
  pageContext: pageContextApi,

  mount(name, el, props = {}) {
    const Component = registry[name];
    if (!Component) {
      console.error(`MyComponents: no component named "${name}"`);
      return;
    }

    // Attach (or reuse) a shadow root so component styles can't leak in or out.
    const shadowRoot = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '';

    if (Component.css) {
      const style = document.createElement('style');
      style.textContent = Component.css;
      shadowRoot.appendChild(style);
    }

    const mountPoint = document.createElement('div');
    shadowRoot.appendChild(mountPoint);

    sdmReady
      .then(() => {
        createRoot(mountPoint).render(createElement(Component, props));
      })
      .catch((err: unknown) => {
        mountPoint.style.cssText = 'font-family: system-ui, sans-serif; padding: 24px; max-width: 640px;';
        mountPoint.innerHTML =
          `<h2 style="margin:0 0 8px">Can't reach the Fluxus server</h2>` +
          `<p style="color:#64748b">The page builder needs <code>@fluxus/server</code> running — start it with ` +
          `<code>npm run dev:server</code> (and seed the demo SDM once with <code>npm run seed:server</code>).</p>` +
          `<pre style="background:#f8fafc;padding:12px;border-radius:6px;white-space:pre-wrap"></pre>`;
        mountPoint.querySelector('pre')!.textContent = err instanceof Error ? err.message : String(err);
      });
  },

  load(components) {
    components.forEach(({ name, elementId, props }) => {
      const el = document.getElementById(elementId);
      if (!el) {
        console.error(`MyComponents: no element with id "${elementId}"`);
        return;
      }
      this.mount(name, el, props);
    });
  },
};
