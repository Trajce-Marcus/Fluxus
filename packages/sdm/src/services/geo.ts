// services.geo — the workbench's read module (DSL Phase 3). Backed by the
// seeded cities/suburbs data; a real geocoder slots behind the same manifest
// when the backend (and the async evaluator) lands.

import { FkPointer, type ServiceModuleDef } from '@fluxus/dsl';
import type { Store } from '@fluxus/engine';
import { toDslRecord } from '@fluxus/engine';

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
