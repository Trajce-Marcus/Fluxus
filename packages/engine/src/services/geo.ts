// services.geo — read module over the cities/suburbs reference data (DSL
// Phase 3). Moved from the sdm workbench at DSL Phase 4: it is built purely on
// the Store contract, so every host (workbench, page builder, server) shares
// one implementation — like `logger`, its sink/source is engine-owned state.
// A real geocoder slots behind the same manifest when one is needed.

import { FkPointer, type ServiceModuleDef } from '@fluxus/dsl';
import type { WaitingStore } from '../store';
import { mapMaybe } from '../maybe';
import { toDslRecord } from '../bridge';

export function buildGeoModule(adapter: WaitingStore): ServiceModuleDef {
  return {
    name: 'geo',
    description: 'Geography lookups over the cities/suburbs reference data.',
    functions: {
      suburbsOf: {
        params: ['city'],
        description: 'Suburb records of the given city (by city id), ordered by name.',
        kind: 'read',
        // Plain over a MemoryAdapter, a promise over the database store — the
        // waiting evaluator takes either.
        fn: (city) => {
          const cityId = city instanceof FkPointer ? String(city.id) : String(city ?? '');
          if (cityId === '') return [];
          return mapMaybe(adapter.getRecordsByField('rt_suburbs', 'city_id', cityId), (rows) =>
            rows
              .map(toDslRecord)
              .sort((a, b) => String(a.fields.name).localeCompare(String(b.fields.name))),
          );
        },
      },
    },
  };
}
