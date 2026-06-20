import type { LogLine, MockContextConfig } from '@wql/types';
import { buildMockContext } from './mockContext';

export interface ExecutionResult {
  success: boolean;
  logs: LogLine[];
  error?: string;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

// Rewrite wf.now - N days to an actual Date subtraction
function preprocessCode(code: string): string {
  return code.replace(/wf\.now\s*-\s*(\d+)/g, (_, days) => {
    const d = new Date('2026-04-03');
    d.setDate(d.getDate() - parseInt(days));
    return `new Date('${d.toISOString().slice(0, 10)}')`;
  });
}

export function executeWQL(
  code: string,
  contextConfig: MockContextConfig
): ExecutionResult {
  const logs: LogLine[] = [];

  function addLog(level: LogLine['level'], msg: string) {
    logs.push({ time: timestamp(), level, msg });
  }

  addLog('info', '─── Execution started ───');
  addLog('info', `Trigger: wo.updated  |  WO: ${contextConfig.woId}`);
  addLog('info', 'Hydrating context objects...');

  try {
    const { wo, wf } = buildMockContext(contextConfig, addLog);
    const prepared = preprocessCode(code);

    // Execute WQL in sandboxed function with injected wo and wf
    // eslint-disable-next-line no-new-func
    const fn = new Function('wo', 'wf', `"use strict";\n${prepared}`);
    fn(wo, wf);

    addLog('success', '─── Execution completed ───');
    return { success: true, logs };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog('error', 'Runtime error: ' + msg);
    return { success: false, logs, error: msg };
  }
}
