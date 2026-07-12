import type { ServiceModuleDef } from '@fluxus/dsl';

// services.logger — engine-owned (createEngine reserves the name): its sink
// is the running activity's history entry (the pipeline is the log; no
// separate log store). One manifest for every consumer — createEngine binds
// the live sink, validateConfig registers it with a no-op so configs using
// services.logger validate identically everywhere. kind 'read' deliberately:
// logging is observability, legal in any hook; the buffer, not the world,
// changes.
export function buildLoggerModule(sink: (line: string) => void): ServiceModuleDef {
  return {
    name: 'logger',
    description: "System log: lines land on the running activity's history entry (system_log).",
    functions: {
      note: {
        params: ['message'],
        description: "Append a line to the run's system log.",
        kind: 'read',
        fn: (message) => {
          sink(String(message ?? ''));
        },
      },
    },
  };
}
