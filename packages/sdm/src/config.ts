import type { ConfigRaw } from './types';
import rawConfig from '../docs/poc_SDM.json';

export const config = rawConfig as unknown as ConfigRaw;
