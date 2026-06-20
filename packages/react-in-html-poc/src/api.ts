import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { pageContextStore, type PageContext } from './store/contextStore';
import { registry } from './components';

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

    createRoot(mountPoint).render(createElement(Component, props));
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
