// services.notify — the server host's implementation. The manifest is
// identical to the workbench's (scripts stay portable across hosts, DSL Phase
// 3 doctrine); only the sink differs. Real delivery (email gateway, in-app
// push) is deliberately NOT built yet: where notifications live long-term is
// part of the open unified-log design — until that lands, the server sink is
// pluggable and defaults to the process log.

import type { ServiceModuleDef } from '@fluxus/dsl';

export interface NotificationEvent {
  channel: 'user' | 'email';
  to?: string;
  subject?: string;
  message: string;
}

export interface NotifySink {
  append(event: NotificationEvent): void;
}

export const consoleNotifySink: NotifySink = {
  append: (event) => {
    console.log(`[notify:${event.channel}]`, event.to ?? '', event.subject ?? '', event.message);
  },
};

export function buildNotifyModule(sink: NotifySink): ServiceModuleDef {
  return {
    name: 'notify',
    description: 'Notifications: in-app messages and (stub) email.',
    functions: {
      user: {
        params: ['message'],
        description: 'Post an in-app notification to the notification centre.',
        kind: 'effect',
        fn: (message) => {
          sink.append({ channel: 'user', message: String(message ?? '') });
        },
      },
      email: {
        params: ['to', 'subject', 'body'],
        description: 'Send an email (stub: recorded on the sink, not delivered).',
        kind: 'effect',
        fn: (to, subject, body) => {
          sink.append({
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
