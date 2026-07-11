// Seeds the stage 2 demo page (once, only if absent): a WorkOrderList wired to
// the sample SDM — workOrders from the store-backed procedure, onDispatch to
// the non-UI dispatch activity, onReschedule to the form-based reschedule
// activity. Delete the page in the explorer to get rid of it; it will reseed
// on next load only if the path is free again.

import { pageExists, savePage, type PageDef } from '../platform-components/page-builder/persistence';

const DEMO_PATH = 'pages/work-orders-demo';

const demoPage: PageDef = {
  layout: {
    root: {
      id: 'root',
      direction: 'vertical',
      size: { type: 'flex', value: 1 },
      children: [
        {
          id: 'slot-main',
          direction: 'vertical',
          size: { type: 'flex', value: 1 },
          background: '#ffffff',
          children: [],
        },
      ],
    },
  },
  componentDependencies: [{ name: 'WorkOrderList', version: '1.0.0' }],
  contextSchema: [],
  slotConfigs: {
    'slot-main': {
      componentName: 'WorkOrderList',
      staticConfig: {},
      dynamicProps: {
        workOrders: { source: 'procedure', procedureName: 'sdm.listWorkOrders', args: {} },
      },
      callbackActions: {
        onDispatch: { type: 'run-activity', activityId: 'act_dispatch_work_orders' },
        onReschedule: { type: 'run-activity', activityId: 'act_reschedule_work_orders' },
      },
    },
  },
};

export function ensureDemoPage(): void {
  if (!pageExists(DEMO_PATH)) savePage(DEMO_PATH, demoPage);
}
