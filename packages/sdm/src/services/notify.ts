// services.notify — the workbench's first effect module (DSL Phase 3).
// In the browser POC "sending" means appending to the notification centre;
// when the backend lands the same manifest fronts a real gateway and no
// script changes.

import type { ServiceModuleDef } from '@fluxus/dsl';
import type { NotificationLog } from '../store/NotificationLog';

export function buildNotifyModule(log: NotificationLog): ServiceModuleDef {
  return {
    name: 'notify',
    description: 'Notifications: in-app messages and (stub) email.',
    functions: {
      user: {
        params: ['message'],
        description: 'Post an in-app notification to the notification centre.',
        kind: 'effect',
        fn: (message) => {
          log.append({ channel: 'user', message: String(message ?? '') });
        },
      },
      email: {
        params: ['to', 'subject', 'body'],
        description: 'Send an email (POC: recorded in the notification centre, not delivered).',
        kind: 'effect',
        fn: (to, subject, body) => {
          log.append({
            channel: 'email',
            to: String(to ?? ''),
            subject: String(subject ?? ''),
            message: String(body ?? ''),
          });
        },
      },
    },
  };
}
