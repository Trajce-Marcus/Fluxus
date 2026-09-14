// A reference attribute says which field it fills — `rt_wbs_nodes.parent_id` —
// and that field says what it points at. The attribute key is an identity for
// a captured value, not a pointer to a field.
//
// The failure this pins: one pooled `parent_id` attribute served both the CBS
// and the WBS and could name only one target, so adding a child to a WBS node
// was refused with "Parent: no cbs_nodes record 'WBS 1'".

import { describe, it, expect } from 'vitest';
import { MemoryAdapter } from '../src/memoryAdapter';
import { attributeFieldRef } from '../src/attributeTypes';
import type { ClientSolutionConfig } from '../src/types';

const config = {
  attributes: [
    { key: 'parent_id', type: 'reference', label: 'Parent', type_config: { fk_record_type: 'rt_cbs_nodes' } },
    { key: 'wbs_parent', type: 'reference', label: 'Parent', type_config: { field: 'rt_wbs_nodes.parent_id' } },
  ],
  recordTypes: [
    {
      id: 'rt_wbs_nodes', name: 'WBS', workflow_ref: 'wf_wbs_nodes', id_field: 'code',
      custom_fields: [
        { key: 'code', type: 'text', label: 'Code', default: '' },
        { key: 'parent_id', type: 'fk_ref', label: 'Parent', default: '', fk_record_type: 'rt_wbs_nodes', fk_display_field: 'code' },
      ],
    },
  ],
  workflows: [{ id: 'wf_wbs_nodes', name: 'WBS', activities: [] }],
} as unknown as ClientSolutionConfig;

const adapter = new MemoryAdapter(config);
const refOf = (key: string) =>
  attributeFieldRef(config.attributes.find((a) => a.key === key)!.type_config as Record<string, unknown>);

describe('a reference attribute naming its field', () => {
  it('reads the record type and the field out of the declaration', () => {
    expect(refOf('wbs_parent')).toEqual({ typeId: 'rt_wbs_nodes', fieldKey: 'parent_id' });
  });

  it('is null for an attribute that names none, which keeps the old rule', () => {
    expect(refOf('parent_id')).toBeNull();
  });

  it('rejects a half-written reference rather than guessing', () => {
    expect(attributeFieldRef({ field: 'rt_wbs_nodes' })).toBeNull();
    expect(attributeFieldRef({ field: '.parent_id' })).toBeNull();
    expect(attributeFieldRef({ field: 'rt_wbs_nodes.' })).toBeNull();
    expect(attributeFieldRef(undefined)).toBeNull();
  });

  // The whole point: the target comes from the field, so the attribute never
  // states it and the two cannot disagree.
  it('takes its target from the field it names, not from the pool', () => {
    const ref = refOf('wbs_parent')!;
    expect(adapter.resolveAttributeTarget(ref.typeId, ref.fieldKey)).toBe('rt_wbs_nodes');
  });

  it('says nothing for a field that is not a reference', () => {
    expect(adapter.resolveAttributeTarget('rt_wbs_nodes', 'code')).toBeUndefined();
  });
});
