import type { TestProject } from 'vitest/node';
import { prepararBaseDePrueba } from '../src/pruebas.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
    appUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const base = await prepararBaseDePrueba('mostrador_test_db');
  project.provide('adminUrl', base.adminUrl);
  project.provide('appUrl', base.appUrl);
}
