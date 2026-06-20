import { create } from 'zustand';
import type { Workflow, LogLine, MockContextConfig } from '@wql/types';

// ─── Sample workflows ─────────────────────────────────────────────────────────

const SAMPLE_WORKFLOWS: Workflow[] = [
  {
    id: 'wf-kpi',
    name: 'WO KPI check',
    file: 'wo-kpi-check.wql',
    status: 'active',
    trigger: { event: 'wo.updated', activityType: 'inspection' },
    createdAt: '2026-01-10',
    updatedAt: '2026-03-28',
    code: `// WO KPI Check
// Trigger: wo.updated
// Checks if a WO is overdue and flags the job

const riskAttrs = wo.attributes.find(
  a => a.code === "riskScore" && a.value.toInt() > 99
);

if (wo.dueDate < (wf.now - 3)) {
  // Flag the KPI as missed on the job
  wo.job.attributes["KPI missed"] = true;

  // Log the event
  wf.log("KPI missed on job " + wo.job.jobNo);

  // Notify the workflow owner (supervisor)
  wf.notify(wf.owner);
}

if (riskAttrs.length > 0) {
  wf.log("High risk score detected: " + riskAttrs[0].value);
  wo.job.attributes["high_risk"] = true;
}`,
  },
  {
    id: 'wf-assign',
    name: 'Auto assign WO',
    file: 'wo-auto-assign.wql',
    status: 'active',
    trigger: { event: 'wo.created' },
    createdAt: '2026-01-15',
    updatedAt: '2026-02-10',
    code: `// Auto Assign WO
// Trigger: wo.created
// Assigns a newly created WO to the project supervisor

const supervisor = wo.job.project.users.find(
  u => u.role === "supervisor"
);

if (!wo.assignedTo && supervisor) {
  wo.assignedTo = supervisor[0];
  wf.log("Auto-assigned WO to " + supervisor[0].name);
  wf.notify(supervisor[0]);
} else if (wo.assignedTo) {
  wf.log("WO already assigned — skipping");
} else {
  wf.log("No supervisor found on project");
}`,
  },
  {
    id: 'wf-asset',
    name: 'Asset status gate',
    file: 'asset-status-gate.wql',
    status: 'inactive',
    trigger: { event: 'wo.created' },
    createdAt: '2026-02-01',
    updatedAt: '2026-02-20',
    code: `// Asset Status Gate
// Trigger: wo.created
// Prevents WOs against decommissioned assets

if (wo.asset && wo.asset.status === "decommissioned") {
  wo.status = "blocked";
  wf.log("Blocked: asset " + wo.asset.assetNo + " is decommissioned");
  wf.notify(wf.owner);
}

if (wo.asset && wo.asset.status === "maintenance") {
  const priority = wo.attributes.find(
    a => a.code === "priority"
  );
  if (!priority || priority[0].value.toString() !== "critical") {
    wo.status = "on_hold";
    wf.log("WO placed on hold — asset under maintenance");
  }
}`,
  },
  {
    id: 'wf-complete',
    name: 'Job completion check',
    file: 'job-completion-check.wql',
    status: 'draft',
    trigger: { event: 'wo.completed' },
    createdAt: '2026-03-01',
    updatedAt: '2026-03-15',
    code: `// Job Completion Check
// Trigger: wo.completed
// Closes the job when all WOs are done

const allDone = wo.job.workOrders.every(
  w => w.status === "completed" || w.status === "cancelled"
);

if (allDone) {
  wo.job.status = "completed";
  wf.log("All WOs complete — closing job " + wo.job.jobNo);
  wf.notify(wf.owner);
} else {
  const remaining = wo.job.workOrders.filter(
    w => w.status !== "completed" && w.status !== "cancelled"
  ).length;
  wf.log(remaining + " WO(s) still pending on job");
}`,
  },
];

// ─── Default mock context ─────────────────────────────────────────────────────

const DEFAULT_CONTEXT: MockContextConfig = {
  woId:        'wo-4821',
  status:      'in_progress',
  activityType:'inspection',
  dueDate:     '2026-03-28',
  assetStatus: 'active',
  riskScore:   142,
  priority:    'high',
};

// ─── Store ────────────────────────────────────────────────────────────────────

interface WorkflowStore {
  workflows:      Workflow[];
  activeId:       string;
  logs:           LogLine[];
  contextConfig:  MockContextConfig;
  activePanel:    'context' | 'log' | 'trigger';
  cursorPos:      { line: number; col: number };
  statusMsg:      string;
  statusOk:       boolean;
  lastRun:        string;

  setActiveId:     (id: string) => void;
  updateCode:      (id: string, code: string) => void;
  addWorkflow:     (wf: Workflow) => void;
  setLogs:         (logs: LogLine[]) => void;
  clearLogs:       () => void;
  setContextConfig:(config: MockContextConfig) => void;
  setActivePanel:  (panel: WorkflowStore['activePanel']) => void;
  setCursorPos:    (line: number, col: number) => void;
  setStatus:       (msg: string, ok: boolean) => void;
  setLastRun:      (time: string) => void;
  updateTrigger:   (id: string, trigger: Workflow['trigger']) => void;
  updateStatus:    (id: string, status: Workflow['status']) => void;

  get activeWorkflow(): Workflow | undefined;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows:     SAMPLE_WORKFLOWS,
  activeId:      'wf-kpi',
  logs:          [],
  contextConfig: DEFAULT_CONTEXT,
  activePanel:   'context',
  cursorPos:     { line: 1, col: 1 },
  statusMsg:     'WQL ready',
  statusOk:      true,
  lastRun:       '',

  get activeWorkflow() {
    return get().workflows.find(w => w.id === get().activeId);
  },

  setActiveId: (id) => set({ activeId: id }),

  updateCode: (id, code) =>
    set(state => ({
      workflows: state.workflows.map(w =>
        w.id === id ? { ...w, code, updatedAt: new Date().toISOString().slice(0, 10) } : w
      ),
    })),

  addWorkflow: (wf) =>
    set(state => ({ workflows: [...state.workflows, wf], activeId: wf.id })),

  setLogs:         (logs)   => set({ logs }),
  clearLogs:       ()       => set({ logs: [] }),
  setContextConfig:(config) => set({ contextConfig: config }),
  setActivePanel:  (panel)  => set({ activePanel: panel }),
  setCursorPos:    (line, col) => set({ cursorPos: { line, col } }),
  setStatus:       (msg, ok)   => set({ statusMsg: msg, statusOk: ok }),
  setLastRun:      (time)  => set({ lastRun: time }),

  updateTrigger: (id, trigger) =>
    set(state => ({
      workflows: state.workflows.map(w => w.id === id ? { ...w, trigger } : w),
    })),

  updateStatus: (id, status) =>
    set(state => ({
      workflows: state.workflows.map(w => w.id === id ? { ...w, status } : w),
    })),
}));
