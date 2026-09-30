import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export const DOCKER_FLAG = 'PIM_IT_DOCKER';
const TESTING_UTILS = join(__dirname, '..', '..', 'testing-utils');
const RUN_LABEL_FALLBACK = 'monorepo-e2e-run';

function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts one Postgres container and applies the real Prisma migrations, reusing the conventions of
 * packages/testing-utils (run label + teardown, `db:migrate:deploy`). Redis is not started: the four scenarios run
 * the pim-* services directly, the BullMQ enqueuers are replaced by recording fakes.
 * Without Docker the flag stays `0` and every suite skips with a clear message.
 */
export default async function globalSetup(): Promise<void> {
  if (
    process.env.PIM_IT_FORCE_SKIP !== '1' &&
    process.env.PIM_IT_REQUIRE_DOCKER === '1' &&
    !dockerAvailable()
  ) {
    throw new Error(
      'PIM_IT_REQUIRE_DOCKER=1 but Docker is not available: refusing to skip the integration tests.',
    );
  }
  if (process.env.PIM_IT_FORCE_SKIP === '1' || !dockerAvailable()) {
    process.env[DOCKER_FLAG] = '0';
    console.warn(
      '\n[pim-runtime integration] SKIPPED: Docker is not available (`docker info` failed). ' +
        'Start Docker and re-run `pnpm --filter @repo/pim-runtime test:integration`. No test was executed.\n',
    );
    return;
  }

  // testcontainers is a devDependency of @repo/testing-utils (strict pnpm), so resolve it from there.
  const req = createRequire(join(TESTING_UTILS, 'package.json'));
  const { PostgreSqlContainer } = req(
    '@testcontainers/postgresql',
  ) as typeof import('@testcontainers/postgresql');
  let label = RUN_LABEL_FALLBACK;
  let runIdEnv = '__E2E_CONTAINERS_RUN_ID__';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const c = require(
      join(TESTING_UTILS, 'dist', 'src', 'e2e', 'constants.js'),
    ) as {
      E2E_RUN_LABEL: string;
      E2E_CONTAINERS_RUN_ID_ENV: string;
    };
    label = c.E2E_RUN_LABEL;
    runIdEnv = c.E2E_CONTAINERS_RUN_ID_ENV;
  } catch {
    // testing-utils not built: the fallbacks above match its constants.
  }

  const runId = String(process.pid);
  const postgres = await new PostgreSqlContainer('postgres:17-alpine')
    .withLabels({ [label]: runId })
    .start();
  const databaseUrl = `${postgres.getConnectionUri()}?schema=public`;

  execSync('pnpm --filter @repo/database db:migrate:deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    timeout: 180_000,
  });

  process.env[DOCKER_FLAG] = '1';
  process.env.DATABASE_URL = databaseUrl;
  process.env[runIdEnv] = runId;
}
