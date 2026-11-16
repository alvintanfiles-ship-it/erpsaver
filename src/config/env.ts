import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGIN: z.string().optional(),

  // Database
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('parkerp'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('password'),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_TTL_SECONDS: z.coerce.number().default(60),

  // OneMap API
  ONEMAP_API_URL: z.string().url().default('https://www.onemap.gov.sg/api'),
  ONEMAP_EMAIL: z.string().email().optional(),
  ONEMAP_PASSWORD: z.string().optional(),

  // LTA DataMall
  LTA_DATAMALL_URL: z.string().url().default('http://datamall2.mytransport.sg/ltaodataservice'),
  LTA_API_KEY: z.string().optional(),

  // URA Space
  URA_SPACE_URL: z.string().url().default('https://www.ura.gov.sg/uraDataService'),
  URA_ACCESS_KEY: z.string().optional(),
  URA_TOKEN: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Helper to get database URL
export const getDatabaseUrl = (): string => {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  return `postgresql://${env.DB_USER}:${env.DB_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`;
};