import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/playwright-report/**', '**/test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      // Nada de SQL armado con strings (regla 3): solo consultas parametrizadas.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='raw'][callee.object.name='sql']",
          message: 'sql.raw arma SQL con strings. Usá parámetros (sql`... ${valor}`).',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Regla 4: prohibido insertar HTML sin escapar.
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Prohibido insertar HTML sin escapar.' },
        { property: 'outerHTML', message: 'Prohibido insertar HTML sin escapar.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Prohibido dangerouslySetInnerHTML (regla 4 de docs/SPEC.md).',
        },
      ],
    },
  },
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'script' },
  },
  {
    // Las rutas de la API solo hablan con la base a través de withKiosco (sección 8).
    files: ['apps/api/src/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pg', message: 'Las rutas no usan el pool directo: usá withKiosco.' },
            { name: 'kysely', message: 'Las rutas no arman conexiones: usá withKiosco.' },
            {
              name: '@mostrador/db',
              importNames: ['crearBaseApp', 'cerrarBaseApp'],
              message: 'Las rutas no crean ni cierran la base: usá withKiosco.',
            },
          ],
          patterns: [
            { group: ['@mostrador/db/*'], message: 'Las rutas solo importan @mostrador/db.' },
            { group: ['**/packages/db/**'], message: 'Las rutas solo importan @mostrador/db.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/test/**/*.ts', '**/e2e/**/*.ts', '**/scripts/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
