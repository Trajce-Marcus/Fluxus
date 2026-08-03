// services.notify — the workbench's effect module (DSL Phase 3). Appends to the
// workbench's NotificationLog, which is dormant since hooks moved server-side;
// see store/NotificationLog for why it stays wired.

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
