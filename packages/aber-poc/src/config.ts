import type { Config } from './types';
import rawConfig from '../docs/sample_inspection_type.json';

export const config = rawConfig as unknown as Config;
