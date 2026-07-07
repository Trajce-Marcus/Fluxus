// Bridge between the SDM runtime and @fluxus/dsl: maps the config to the
// validator's DslSchema, the Store to the evaluator's RecordsHost, and builds
// EvalHosts for script execution. Scripts use short type names (records.assets),
// the store uses prefixed ids (rt_assets) — the bridge owns that translation.

import type { DslRecord, DslSchema, EvalHost, RecordsHost } from '@fluxus/dsl';
import type { ConfigRaw, RecordInstance } from '../types';
import type { Store } from '../store/interface';

export const shortName = (rtId: string): string => rtId.replace(/^rt_/, '');
export const fullId = (short: string): string => `rt_${short}`;

export function buildDslSchema(config: ConfigRaw): DslSchema {
  const types: DslSchema['types'] = {};
  for (const rt of config.recordTypes) {
    const fields: DslSchema['types'][string]['fields'] = {};
    for (const cf of rt.custom_fields) {
      fields[cf.key] = {
        type: cf.type,
        ...(cf.type === 'fk_ref' && cf.fk_record_type
          ? { fkTarget: shortName(cf.fk_record_type) }
          : {}),
      };
    }
    types[shortName(rt.id)] = { fields };
  }
  return { types };
}

function toDslRecord(record: RecordInstance): DslRecord {
  return { id: record.id, type: shortName(record.typeRef), fields: record.customFields };
}

export function buildRecordsHost(adapter: Store, config: ConfigRaw): RecordsHost {
  const byShortName = new Map(config.recordTypes.map((rt) => [shortName(rt.id), rt]));

  return {
    hasType: (type) => byShortName.has(type),
    getAll: (type) => {
      const rt = byShortName.get(type);
      if (!rt) return [];
      return adapter.getRecordTypeData(rt.id).map(toDslRecord);
    },
    getById: (type, id) => {
      try {
        const record = adapter.getRecord(String(id));
        return record.typeRef === fullId(type) ? toDslRecord(record) : null;
      } catch {
        return null;
      }
    },
    fkTarget: (type, field) => {
      const cf = byShortName.get(type)?.custom_fields.find((c) => c.key === field);
      return cf?.type === 'fk_ref' && cf.fk_record_type ? shortName(cf.fk_record_type) : null;
    },
    reverseRef: (type, name) => {
      const source = byShortName.get(name);
      if (!source) return null;
      const fk = source.custom_fields.find(
        (c) => c.type === 'fk_ref' && c.fk_record_type === fullId(type),
      );
      return fk ? { sourceType: name, field: fk.key } : null;
    },
  };
}

export interface ScriptContext {
  attrs?: Record<string, unknown>;
  anchorRecord?: RecordInstance | null;
  activity?: { id: string; name: string };
  workflow?: { id: string; name: string };
}

export function buildEvalHost(adapter: Store, config: ConfigRaw, script: ScriptContext): EvalHost {
  // Empty-string form values read as null in scripts, so `attrs.city is not null`
  // behaves before anything is selected.
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(script.attrs ?? {})) {
    attrs[key] = value === '' ? null : value;
  }

  return {
    records: buildRecordsHost(adapter, config),
    ctx: {
      user: { id: 'demo', name: 'Demo User' },
      record: script.anchorRecord ? toDslRecord(script.anchorRecord) : null,
      activity: script.activity ?? null,
      workflow: script.workflow ?? null,
    },
    attrs,
  };
}
