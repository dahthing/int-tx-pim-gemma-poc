import { join } from 'node:path';

export default async function globalTeardown(): Promise<void> {
  if (process.env.PIM_IT_DOCKER !== '1') return;
  // Same label-based cleanup as the other suites (packages/testing-utils).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const teardown = require(
    join(
      __dirname,
      '..',
      '..',
      'testing-utils',
      'dist',
      'src',
      'e2e',
      'global-teardown.js',
    ),
  ) as {
    default: () => Promise<void>;
  };
  await teardown.default();
}
