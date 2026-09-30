import type { INestApplication, Provider, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { TenantContext } from '@repo/pim-runtime';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';

export const TENANT_ID = 'tenant-1';

export interface TestAppOptions {
  controllers: Type[];
  providers: Provider[];
  user?: Record<string, unknown>;
}

/** A real Nest HTTP app with the global Zod pipe and serializer interceptor (as SharedModule registers them) and mocked services. */
export async function createTestApp(
  options: TestAppOptions,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: options.controllers,
    providers: [
      {
        provide: TenantContext,
        useValue: { resolve: jest.fn().mockResolvedValue(TENANT_ID) },
      },
      ...options.providers,
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalInterceptors(new ZodSerializerInterceptor(app.get(Reflector)));
  // Stand-in for the auth guard: puts the authenticated user on the request.
  app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = options.user ?? { id: 'u1', email: 'admin@gemma.pt' };
    next();
  });
  await app.init();
  return app;
}
