import { useEffect, useRef, useState } from 'react';
import { notificationLog } from '../context/AppContext';
import { ComponentLabel } from '../context/UatLabels';

// Notification centre — where queued services.notify.* calls land (DSL Phase 3).
// A bell in the header with an unseen count; the panel lists newest first.

const LAST_SEEN_KEY = 'fluxus:sdm:notifications-last-seen';

export function NotificationCentre() {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => notificationLog.subscribe(() => setTick(t => t + 1)), []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const entries = notificationLog.list();
  const lastSeen = localStorage.getItem(LAST_SEEN_KEY) ?? '';
  const unseen = entries.filter(e => e.timestamp > lastSeen).length;

  const toggle = () => {
    if (!open && entries.length > 0) {
      localStorage.setItem(LAST_SEEN_KEY, entries[0].timestamp);
    }
    setOpen(o => !o);
  };

  return (
    <div ref={panelRef} style={{ position: 'relative', marginLeft: 'auto' }}>
      {/* Sits left of the bell — the header is too short for a corner badge */}
      <ComponentLabel
        name="NotificationCentre"
        style={{ top: '50%', right: '100%', transform: 'translateY(-50%)', marginRight: 6, borderRadius: 4 }}
      />
      <button
        onClick={toggle}
        title="Notifications"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 18,
          color: '#e2e8f0',
          position: 'relative',
          padding: '2px 6px',
        }}
      >
        🔔
        {unseen > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', color: '#fff', borderRadius: 999,
            fontSize: 10, fontWeight: 700, lineHeight: 1,
            padding: '3px 5px', minWidth: 16, textAlign: 'center',
          }}>
            {unseen}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '130%', width: 340, maxHeight: 420,
          overflowY: 'auto', background: '#fff', color: '#1e293b',
          border: '1px solid #e2e8f0', borderRadius: 6, zIndex: 50,
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderBottom: '1px solid #e2e8f0',
            fontSize: 12, fontWeight: 600, color: '#475569', textTransform: 'uppercase',
          }}>
            Notifications
            {entries.length > 0 && (
              <button
                onClick={() => notificationLog.clear()}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: '#64748b', fontSize: 11, textTransform: 'none', fontWeight: 500,
                }}
              >
                Clear all
              </button>
            )}
          </div>
          {entries.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>
              Nothing yet — activities queue notifications here.
            </div>
          ) : (
            entries.map(e => (
              <div key={e.id} style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, color: e.channel === 'email' ? '#7c3aed' : '#0369a1' }}>
                    {e.channel === 'email' ? `✉ ${e.to}` : 'In-app'}
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {new Date(e.timestamp).toLocaleString()}
                  </span>
                </div>
                {e.subject && <div style={{ fontWeight: 600 }}>{e.subject}</div>}
                <div style={{ color: '#334155' }}>{e.message}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
