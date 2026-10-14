# 001. Monorepo con pnpm y TypeScript sin paso de compilación

**Fecha:** octubre de 2026 · **Etapa:** A

## Contexto

La spec pide un monorepo con pnpm workspaces, TypeScript `strict`, ESLint, Prettier, Vitest y
Playwright (sección 6). Hacía falta decidir cómo se comparten los paquetes internos
(`@mostrador/shared`, `db`, `ui`) entre la app, la API y las pruebas.

## Decisión

- Los paquetes internos exportan su código fuente `.ts` directamente (`"exports": "./src/index.ts"`).
- La API y los scripts corren con Node 22, que ejecuta TypeScript quitando los tipos
  (sin `tsx` ni `ts-node`). Por eso `tsconfig.base.json` activa `erasableSyntaxOnly` y
  `allowImportingTsExtensions`: los imports locales llevan `.ts` y no se usan `enum` ni
  propiedades de parámetro.
- `tsc` solo verifica tipos (`noEmit`). Vite compila la PWA.
- Versiones exactas (`save-exact`) y `engine-strict`.
- TypeScript 6.0 (el 7, la versión nativa, todavía no es compatible con typescript-eslint).
- `@playwright/test` fijado en 1.56.1, la versión que coincide con el Chromium del entorno de
  desarrollo en la nube. En CI se instala el navegador correspondiente.

## Alternativas

- **Compilar cada paquete a `dist/`** (tsc -b o tsup): más pasos y más lento en desarrollo; se
  puede sumar en la Etapa H si la imagen de producción lo necesita.
- **tsx:** una dependencia más para algo que Node 22 ya hace.

## Pendiente

`apps/worker` y `apps/admin` se crean cuando haya algo que poner (Etapas B y F); no se dejan
carpetas vacías.
