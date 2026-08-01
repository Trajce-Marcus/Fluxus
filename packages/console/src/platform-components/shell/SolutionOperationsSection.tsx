// Solution → Operations: the operations admin, scoped to the open solution
// (M17, ruled 2026-07-31 — it left the organisation menu). An operation runs
// exactly one solution, so it is administered from inside that solution:
// the inner panel lists them, the main area is the operation view.

import { useShellState } from './useShellState';
import { OperationsAdmin } from '../admin/OperationsAdmin';

export function SolutionOperationsSection() {
  const { solutionId } = useShellState(['solutionId']);
  if (!solutionId) return <div className="admin-panel"><p className="admin-muted">No solution open.</p></div>;
  // Keyed so switching solutions rebuilds the list and selection.
  return <OperationsAdmin key={solutionId} solutionId={solutionId} />;
}
