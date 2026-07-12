// services.geo — read module over the cities/suburbs reference data (DSL
// Phase 3). Moved from the sdm workbench at DSL Phase 4: it is built purely on
// the Store contract, so every host (workbench, page builder, server) shares
// one implementation — like `logger`, its sink/source is engine-owned state.
// A real geocoder slots behind the same manifest when one is needed.

import { FkPointer, type ServiceModuleDef } from '@fluxus/dsl';
import type { Store } from '../store';
import { toDslRecord } from '../bridge';

export function buildGeoModule(adapter: Store): ServiceModuleDef {
  return {
    name: 'geo',
    description: 'Geography lookups over the cities/suburbs reference data.',
    functions: {
      suburbsOf: {
        params: ['city'],
        description: 'Suburb records of the given city (by city id), ordered by name.',
        kind: 'read',
        fn: (city) => {
          const cityId = city instanceof FkPointer ? String(city.id) : String(city ?? '');
          if (cityId === '') return [];
          return adapter
            .getRecordsByField('rt_suburbs', 'city_id', cityId)
            .map(toDslRecord)
            .sort((a, b) => String(a.fields.name).localeCompare(String(b.fields.name)));
        },
      },
    },
  };
}
