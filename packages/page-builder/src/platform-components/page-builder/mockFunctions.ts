// Mock tRPC function registry — stand-in until the real backend is wired up.
// Each function receives a flat args object (keys match DynamicPropConfig.args)
// and returns a Promise of the data for that prop.

export type MockFn = (args: Record<string, unknown>) => Promise<unknown>;

import { sdmStore } from '../../sdm-runtime/engine';

const MOCK_INVENTORS = [
  { name: 'Nikola Tesla',   invention: 'AC Motor',      date: '1888', country: 'Serbia',   birthYear: 1856, deathYear: 1943, bio: 'Pioneer of alternating current electrical systems.' },
  { name: 'Thomas Edison',  invention: 'Phonograph',    date: '1877', country: 'USA',      birthYear: 1847, deathYear: 1931, bio: 'Prolific inventor who developed the phonograph and a practical incandescent light bulb.' },
  { name: 'Marie Curie',    invention: 'Radioactivity', date: '1898', country: 'Poland',   birthYear: 1867, deathYear: 1934, bio: 'First woman to win a Nobel Prize and the only person to win in two sciences.' },
  { name: 'Alexander Bell', invention: 'Telephone',     date: '1876', country: 'Scotland', birthYear: 1847, deathYear: 1922, bio: 'Credited with patenting the first practical telephone.' },
];

export const mockRegistry: Record<string, MockFn> = {
  'inventor.getAll': async () => MOCK_INVENTORS,

  'inventor.getByName': async ({ name }) =>
    MOCK_INVENTORS.find((i) => i.name === name) ?? MOCK_INVENTORS[0],

  'inventor.getFirst': async () => MOCK_INVENTORS[0],

  'platform.currentUser': async () => 'Demo User',

  'platform.appName': async () => 'Fluxus',

  'map.getLocation': async () => ({ x: 42, y: 67 }),

  // Real procedure backed by the page builder's SDM store (Extraction stage 2):
  // same function-call-by-name shape the backend will keep (tRPC per root
  // ARCHITECTURE.md), so wiring never changes when localStorage swaps out.
  'sdm.listWorkOrders': async () =>
    sdmStore.getRecordTypeData('rt_work_orders').map((r) => ({ ...r.customFields })),
};
