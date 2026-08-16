// Where the workbench hands the standard capture form (now
// @fluxus/page-runtime's, shared 2026-08-16) everything it needs.
//
// The host itself is built in WorkbenchContext; the record picker is added
// here because it is a component, and a context module that imports components
// which import it back is a cycle nobody should have to reason about. Browsing
// records to pick one is the workbench's alone — it needs the record snapshot
// a page does not have.

import { useMemo, type ReactNode } from 'react';
import { CaptureHostProvider, type CaptureHost } from '@fluxus/page-runtime';
import { useWorkbench } from '../WorkbenchContext';
import { RecordPickerDialog } from './RecordPickerDialog';

export function WorkbenchCaptureHost({ children }: { children: ReactNode }) {
  const { captureHost } = useWorkbench();
  const host = useMemo<CaptureHost>(
    () => ({ ...captureHost, recordPicker: RecordPickerDialog }),
    [captureHost]
  );
  return <CaptureHostProvider host={host}>{children}</CaptureHostProvider>;
}
