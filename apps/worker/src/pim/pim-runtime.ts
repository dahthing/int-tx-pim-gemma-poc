// Single import point for the PIM runtime contract (implemented in
// packages/pim-runtime). Consumers import from here so the seam is swappable.
export { PimJobs, PimRuntimeModule } from '@repo/pim-runtime';
