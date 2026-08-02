import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHostAuth, PlatformClient } from '@fluxus/client';
import App from './App';
import { SignIn } from './SignIn';

const root = createRoot(document.getElementById('root')!);

// Same auth seam as the other two apps (RBAC_DESIGN §0), with one difference
// that matters: the Runtime and Console fall open when it is UNCONFIGURED,
// because a server with no identity to check gates nothing. This app never
// does — every call needs a caller in FLUXUS_PLATFORM_ADMINS, and a tokenless
// request matches nobody.
//
// So an unconfigured platform app is not a demo posture, it is a broken
// install, and it says so here rather than rendering a UI whose every call
// comes back 401. There is no platform plane without auth.
const auth = createHostAuth(import.meta.env.VITE_NEON_AUTH_URL);

async function boot(): Promise<void> {
  if (!auth.configured) {
    root.render(<NotConfigured />);
    return;
  }
  const session = await auth.session();
  if (!session) {
    root.render(<SignIn auth={auth} onSignedIn={() => void boot()} />);
    return;
  }
  const client = PlatformClient.create({
    url: import.meta.env.VITE_FLUXUS_API_URL,
    getToken: auth.getToken,
  });
  root.render(
    <StrictMode>
      <App
        client={client}
        who={session.email}
        onSignOut={() => {
          void auth.signOut().then(() => void boot());
        }}
      />
    </StrictMode>,
  );
}

/** No `VITE_NEON_AUTH_URL`: there is nobody to be, so there is nothing to show.
 *  Naming both halves of the setup matters — the app-side var and the
 *  server-side allowlist fail identically from here, and only one of them is
 *  visible to this bundle. */
function NotConfigured() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 560, margin: '10vh auto 0' }}>
      <h2 style={{ margin: '0 0 8px' }}>Platform app is not configured</h2>
      <p style={{ color: '#475569', lineHeight: 1.5 }}>
        This app has no sign-in, so every call would be rejected. Unlike the Console and Runtime, it has no
        demo posture: the platform plane is defined by who you are.
      </p>
      <p style={{ color: '#475569', lineHeight: 1.5, margin: '16px 0 4px' }}>Two things are needed:</p>
      <pre
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          padding: 12,
          borderRadius: 6,
          fontSize: 13,
          overflowX: 'auto',
        }}
      >
{`packages/platform/.env.local
  VITE_NEON_AUTH_URL=<your Neon Auth URL>

packages/server/.env
  FLUXUS_PLATFORM_ADMINS=you@example.com`}
      </pre>
      <p style={{ color: '#94a3b8', fontSize: 13 }}>Restart both after editing.</p>
    </div>
  );
}

void boot();
