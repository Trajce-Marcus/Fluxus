// Sample SDM config for the page builder host — deliberately tiny (one record
// type) and separate from the sdm workbench's sample. Config distribution
// (one canonical config shared across hosts) is an open thread on the root
// ROADMAP; until then each host ships its own copy, per the Extraction
// stage 2 design.

import type { ConfigRaw } from '@fluxus/engine';

export const config: ConfigRaw = {
  attributes: [
    { key: 'id', label: 'Work order no.', description: 'Natural key.', type: 'text' },
    { key: 'location', label: 'Location', description: 'Where the work is.', type: 'text' },
    { key: 'due_date', label: 'Due date', description: 'When the work is due.', type: 'date' },
  ],
  recordTypes: [
    {
      id: 'rt_work_orders',
      name: 'Work Orders',
      description: 'A work order (page-builder host sample).',
      workflow_ref: 'wf_work_orders',
      id_field: 'id',
      custom_fields: [
        { key: 'id', type: 'text', required: true },
        { key: 'location', type: 'text' },
        { key: 'status', type: 'text', default: 'Raised' },
        { key: 'crew', type: 'text' },
        { key: 'due_date', type: 'text' },
      ],
    },
  ],
  workflows: [
    {
      id: 'wf_work_orders',
      name: 'Work Orders',
      description: 'Work order lifecycle (sample).',
      activities: [
        {
          id: 'act_create_work_orders',
          name: 'Create Work Order',
          description: 'Raise a new work order.',
          sort_order: 1,
          record_map: 'CREATE',
          attributes: [
            { attribute_ref: 'id', required: true },
            { attribute_ref: 'location' },
          ],
          before_hook: null,
          after_hook: null,
        },
        {
          // Non-UI activity: no attributes to capture, so an app trigger
          // passes straight through to the hooks. The callback's data object
          // arrives as the `callbackData` root; the hook writes attributes
          // onto the entry and notes a system log line.
          id: 'act_dispatch_work_orders',
          name: 'Dispatch Work Order',
          description: 'Dispatch this work order to a crew (app-triggered, no form).',
          sort_order: 2,
          show_condition: "context.record.status <> 'Dispatched'",
          attributes: [],
          before_hook: null,
          after_hook: [
            "attributes.wo = context.record.id",
            "attributes.crew = callbackData.crew",
            "context.record.update({ status: 'Dispatched', crew: callbackData.crew })",
            "services.logger.note('Dispatched ' + context.record.id + ' to ' + callbackData.crew)",
          ],
        },
        {
          id: 'act_reschedule_work_orders',
          name: 'Reschedule Work Order',
          description: 'Change the due date (app-triggered, standard capture form).',
          sort_order: 3,
          record_map: 'UPDATE',
          attributes: [{ attribute_ref: 'due_date', required: true }],
          before_hook: null,
          after_hook: null,
        },
      ],
    },
  ],
  seeds: [
    {
      typeId: 'rt_work_orders',
      records: [
        { id: 'WO-100', fields: { id: 'WO-100', location: 'Melbourne', status: 'Raised', crew: '', due_date: '2026-07-20' } },
        { id: 'WO-101', fields: { id: 'WO-101', location: 'Geelong', status: 'Raised', crew: '', due_date: '2026-07-25' } },
      ],
    },
  ],
};
