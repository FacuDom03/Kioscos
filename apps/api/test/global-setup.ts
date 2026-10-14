import { prepararBaseDePrueba } from '@mostrador/db/pruebas';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    appUrl: string;
    adminUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const base = await prepararBaseDePrueba('mostrador_test_api');
  project.provide('appUrl', base.appUrl);
  project.provide('adminUrl', base.adminUrl);
}
