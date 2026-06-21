import dotenv from 'dotenv';

dotenv.config();

interface Config {
  port: number;
  nodeEnv: string;
  trustProxy: number;
  jwtSecret: string;
  sentryJSFrontend: string;
  sentryDSNBackend: string;
}

const DEFAULT_PORT = 3000;

export const config: Config = {
  port: Number(process.env.PORT) || DEFAULT_PORT,
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  jwtSecret: process.env.JWT_SECRET || 'super-secret-key-change-me',
  sentryJSFrontend: process.env.SENTRY_JS_FRONTEND || '',
  sentryDSNBackend: process.env.SENTRY_DSN_BACKEND || ''
};

// User Validation Constants
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 50;

// Time Constants
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_HOUR = 60;
export const SECONDS_PER_MINUTE = 60;
export const MS_PER_SECOND = 1000;
const SECONDS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
export const MS_PER_DAY = SECONDS_PER_DAY * MS_PER_SECOND;
export const TOKEN_EXPIRY_MS = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

// Cookie Constants
export const COOKIE_MAX_AGE_DAYS = 30;

// Rate Limiting Constants
export const RATE_LIMIT_WINDOW_MINUTES = 5;
const RATE_LIMIT_SEC_WINDOW = RATE_LIMIT_WINDOW_MINUTES * SECONDS_PER_MINUTE;
export const RATE_LIMIT_WINDOW_MS = RATE_LIMIT_SEC_WINDOW * MS_PER_SECOND;
export const RATE_LIMIT_MAX = 1000;

export const RATE_LIMIT_DAILY_WINDOW_MS = MS_PER_DAY;
export const RATE_LIMIT_DAILY_MAX = 2500;

// GDrive Constants
export const GDRIVE_RESUMABLE_INCOMPLETE = 308;

// Uppy Constants
const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;
const MB_PER_GB = 1024;
export const UPPY_MAX_FILE_SIZE = MB_PER_GB * KB_PER_MB * BYTES_PER_KB; // 1GB
const CHUNK_SIZE_MB = 80;
export const UPPY_CHUNK_SIZE = CHUNK_SIZE_MB * KB_PER_MB * BYTES_PER_KB; // 80MB

// Security Constants
const MINUTES_PER_SESSION = 60;
const CLEANUP_MINUTES = 30;
const SECONDS_PER_SESSION = 2 * MINUTES_PER_SESSION * SECONDS_PER_MINUTE;
export const SESSION_TTL_MS = SECONDS_PER_SESSION * MS_PER_SECOND;
export const CLEANUP_INTERVAL_MS = CLEANUP_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;
const MAX_CHUNK_MB = 100;
export const MAX_CHUNK_BUFFER_SIZE = MAX_CHUNK_MB * KB_PER_MB * BYTES_PER_KB;

// Turnstile Constants
export const TURNSTILE_TIMEOUT_MS = 2000;
export const TURNSTILE_RETRIES = 2;
export const TURNSTILE_RETRY_DELAY_MS = 1000;

export default config;
