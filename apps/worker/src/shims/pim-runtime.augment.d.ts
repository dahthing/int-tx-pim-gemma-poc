// TODO(pim-runtime): TEMPORARY type shim, delete once `@repo/pim-runtime`
// exports `PimRuntimeModule` from its barrel. This is a module augmentation:
// when the real export lands, TS reports a duplicate identifier here, which is
// the signal to remove this file. PimJobs already comes from the real package.
import type { DynamicModule } from '@nestjs/common';

declare module '@repo/pim-runtime' {
  export class PimRuntimeModule {
    static register(): DynamicModule;
  }
}
