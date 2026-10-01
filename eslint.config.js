import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'supabase/.temp',
      'src/types/database.generated.ts',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Import boundaries (PROJECT_STRUCTURE §14): domain and lib must stay UI-free.
  {
    files: ['src/domain/**/*.ts', 'src/lib/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*'],
              message: 'domain/lib must not depend on React.',
            },
            {
              group: ['@/features/*', '@/app/*', '@/components/*'],
              message: 'domain/lib must not import UI layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*'],
              message: 'domain must stay pure (no React).',
            },
            {
              group: ['@/features/*', '@/app/*', '@/components/*'],
              message: 'domain must not import UI layers.',
            },
            {
              group: ['@supabase/*', '@/lib/supabase*'],
              message: 'domain must not call Supabase directly.',
            },
          ],
        },
      ],
    },
  },
  prettier,
)
