// Slice 1 (ATTRIBUTE_TYPES_FILES_SCALARS): the type registry, the new scalar
// coercions, structured (descriptor/multi) threading, and the config-key rules
// validateConfig now enforces.

import { describe, expect, it } from 'vitest';
import { coerceValue, coerceCapturedValue, isBlank } from '../src/bridge';
import { descriptorShapeIssues } from '../src/attributeTypes';
import { validateConfig } from '../src/validateConfig';
import type { ConfigRaw } from '../src/types';

describe('coerceValue — new scalar types', () => {
  it('datetime parses to a Date (offset-bearing ISO)', () => {
    const v = coerceValue('datetime', '2026-07-18T14:30:00+10:00');
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).toISOString()).toBe('2026-07-18T04:30:00.000Z');
  });
  it('decimal parses to a number', () => {
    expect(coerceValue('decimal', '3.14')).toBe(3.14);
  });
  it('time stays a string (zone-less HH:MM)', () => {
    expect(coerceValue('time', '09:30')).toBe('09:30');
  });
  it('empty is null', () => {
    expect(coerceValue('decimal', '')).toBeNull();
  });
});

describe('coerceCapturedValue — structured values', () => {
  it('maps a multi array element-wise', () => {
    expect(coerceCapturedValue('int', ['1', '2', '3'])).toEqual([1, 2, 3]);
  });
  it('passes a descriptor bag through by-value', () => {
    const bag = { storage_key: 'k', name: 'a.jpg', mime: 'image/jpeg', size: 10, hash: 'h' };
    expect(coerceCapturedValue('photo', bag)).toBe(bag);
  });
});

describe('isBlank', () => {
  it('treats empty string / empty array / null as blank', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank('  ')).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank(null)).toBe(true);
  });
  it('treats a descriptor bag and a non-empty array as present', () => {
    expect(isBlank({ storage_key: 'k' })).toBe(false);
    expect(isBlank(['x'])).toBe(false);
  });
});

describe('descriptorShapeIssues', () => {
  const photo = {
    storage_key: '2026/07/uuid/a.jpg', name: 'a.jpg', mime: 'image/jpeg', size: 12345, hash: 'abc',
    width: 800, height: 600, thumb_key: '2026/07/uuid/thumb.jpg',
  };
  it('accepts a valid photo with no EXIF (optional fields absent)', () => {
    expect(descriptorShapeIssues('photo', photo, 'Photo')).toEqual([]);
  });
  it('accepts a valid file descriptor', () => {
    expect(descriptorShapeIssues('file', { storage_key: 'k', name: 'd.pdf', mime: 'application/pdf', size: 9, hash: 'h' }, 'File')).toEqual([]);
  });
  it('flags a missing required field', () => {
    const { hash, ...noHash } = photo;
    expect(descriptorShapeIssues('photo', noHash, 'Photo')).toContain("Photo is missing 'hash'");
  });
  it('flags a wrong scalar kind', () => {
    expect(descriptorShapeIssues('file', { storage_key: 'k', name: 'd', mime: 'm', size: 'big', hash: 'h' }, 'File'))
      .toContain("File field 'size' must be a number");
  });
  it('flags a non-object', () => {
    expect(descriptorShapeIssues('photo', 'not-a-bag', 'Photo')).toEqual(['Photo is not a valid photo']);
  });
  it('is a no-op for non-descriptor types', () => {
    expect(descriptorShapeIssues('text', 'anything', 'X')).toEqual([]);
  });
});

describe('validateConfig — type_config key rules (§3/§11)', () => {
  const base = (attributes: ConfigRaw['attributes']): ConfigRaw => ({
    attributes,
    recordTypes: [],
    workflows: [],
  });
  const errorsOf = (cfg: ConfigRaw) => validateConfig(cfg).map((f) => f.diagnostic.message);

  it('accepts a well-formed photo/file config', () => {
    const cfg = base([
      { key: 'site_photos', label: 'Site photos', description: '', type: 'photo', type_config: { multi: true, max_count: 8, max_size_mb: 10 } },
      { key: 'permit', label: 'Permit', description: '', type: 'file', type_config: { accept: ['.pdf'], max_size_mb: 20 } },
    ]);
    expect(errorsOf(cfg)).toEqual([]);
  });

  it('rejects an unknown type_config key for a type', () => {
    const cfg = base([
      { key: 'when', label: 'When', description: '', type: 'datetime', type_config: { max_size_mb: 5 } },
    ]);
    expect(errorsOf(cfg)).toContain("unknown type_config key 'max_size_mb' for type 'datetime'");
  });

  it('rejects multi on a composite (§11)', () => {
    const cfg = base([
      { key: 'ok', label: 'OK', description: '', type: 'text' },
      { key: 'row', label: 'Row', description: '', type: 'composite', type_config: { multi: true, attributes: [{ attribute_ref: 'ok' }] } },
    ]);
    expect(errorsOf(cfg)).toContain("'composite' attributes cannot be multi");
  });
});
