import dotenv from 'dotenv';
import { EnvConfig } from '../types';

dotenv.config({ override: false });

export const config: EnvConfig = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  ASTRBOT_URL: process.env.ASTRBOT_URL || 'http://localhost:5000',
  ASTRBOT_TOKEN: process.env.ASTRBOT_TOKEN || '',
  ASTRBOT_ID: process.env.ASTRBOT_ID || '123456789',
  WS_PATH: process.env.WS_PATH || '/ws',
};
