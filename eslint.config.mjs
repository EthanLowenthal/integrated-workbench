import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/test/fixtures/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Spec: only execFile with argument arrays, never shell strings.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use execFile with an argument array.',
            },
            {
              name: 'node:child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use execFile with an argument array.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vscode', message: 'src/core must never import vscode (keep it extractable).' },
            {
              name: 'child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use execFile with an argument array.',
            },
            {
              name: 'node:child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use execFile with an argument array.',
            },
          ],
        },
      ],
    },
  },
);
