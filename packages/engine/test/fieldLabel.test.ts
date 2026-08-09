// A custom field's display name (2026-08-09). `label` arrived long after the
// key did, so the fallback is the whole point: nothing stored before it may
// render blank.

import { describe, expect, it } from 'vitest';
import { fieldLabel } from '../src/bridge';

describe('fieldLabel', () => {
  it('shows the label when there is one', () => {
    expect(fieldLabel({ key: 'due_date', label: 'Due date', type: 'date' })).toBe('Due date');
  });

  it('falls back to the key when there is none', () => {
    expect(fieldLabel({ key: 'due_date', type: 'date' })).toBe('due_date');
  });

  it('treats a blank or whitespace label as none', () => {
    expect(fieldLabel({ key: 'due_date', label: '', type: 'date' })).toBe('due_date');
    expect(fieldLabel({ key: 'due_date', label: '   ', type: 'date' })).toBe('due_date');
  });
});
