import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initHost } from './host';

const root = createRoot(document.getElementById('root')!);

initHost()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  })
  .catch((err: unknown) => {
    root.render(
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 640 }}>
        <h2 style={{ margin: '0 0 8px' }}>Can't reach the Fluxus server</h2>
        <p style={{ color: '#64748b' }}>
          The workbench needs <code>@fluxus/server</code> running — start it with{' '}
          <code>npm run dev:server</code> (and seed the demo SDM once with{' '}
          <code>npm run seed:server</code>).
        </p>
        <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap' }}>
          {err instanceof Error ? err.message : String(err)}
        </pre>
      </div>
    );
  });
