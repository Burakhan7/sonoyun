import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prismaClient from '@prisma/client';

const { PrismaClient } = prismaClient;
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEST_DATABASE = 'oyun_sohbet_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function configuredUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = resolve(appRoot, '.env');
  const line = existsSync(envFile)
    ? readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .find((entry) => entry.startsWith('DATABASE_URL='))
    : undefined;
  if (!line) throw new Error('Set TEST_DATABASE_URL or DATABASE_URL in apps/realtime/.env');
  const url = new URL(line.slice('DATABASE_URL='.length));
  url.pathname = `/${TEST_DATABASE}`;
  // On Windows, localhost tries IPv6 first and each new connection stalls for about 2 seconds.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.toString();
}

/** Creates and migrates a dedicated local test database. It never touches the dev database. */
export default async function setup() {
  const url = new URL(configuredUrl());
  const database = url.pathname.slice(1);
  if (!LOCAL_HOSTS.has(url.hostname) || !database.endsWith('_test')) {
    throw new Error('Tests only run against a local database whose name ends in _test');
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const rows = await admin.$queryRaw<unknown[]>`
      SELECT 1 FROM pg_database WHERE datname = ${database}`;
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.$disconnect();
  }

  const require = createRequire(import.meta.url);
  const prismaCli = resolve(dirname(require.resolve('prisma/package.json')), 'build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
  process.env.TEST_DATABASE_URL = url.toString();
}
