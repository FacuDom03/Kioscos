import { prepararBaseDePrueba } from '@mostrador/db/pruebas';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
    panelUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const base = await prepararBaseDePrueba('mostrador_test_panel');
  project.provide('adminUrl', base.adminUrl);
  project.provide('panelUrl', base.panelUrl);
}
