// Seeds the demo page (once, only if absent): a WorkOrderList wired to the
// sample SDM in FluxScript — workOrders from a records expression, onDispatch
// to the non-UI dispatch activity, onReschedule to the form-based reschedule
// activity (both via services.page.runActivity). Delete the page in the
// explorer to get rid of it; it will reseed on next load only if the path is
// free again.

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
        workOrders: `records.work_orders`,
      },
      callbacks: {
        onDispatch: `services.page.runActivity('act_dispatch_work_orders', callbackData.value, callbackData.data)`,
        onReschedule: `services.page.runActivity('act_reschedule_work_orders', callbackData.value, callbackData.data)`,
      },
    },
  },
};

export function ensureDemoPage(): void {
  if (!pageExists(DEMO_PATH)) savePage(DEMO_PATH, demoPage);
}
