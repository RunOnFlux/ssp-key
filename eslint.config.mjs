import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  eslintPluginPrettierRecommended,
  {
    ignores: [
      'coverage/**',
      'android/**',
      'ios/**',
      'node_modules/**',
      '.prettierrc.js',
    ],
  },
  { files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'] },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'babel.config.js',
            'eslint.config.mjs',
            'index.js',
            'jest.config.js',
            'jest.setup.js',
            'metro.config.js',
            'react-native.config.js',
            'shim.js',
          ],
          defaultProject: './tsconfig.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.jest,
        ...globals.node,
      },
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  pluginReact.configs.flat.recommended,
  {
    plugins: {
      'react-hooks': pluginReactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'off',
      // The new react-hooks v6+ rules flag patterns this codebase uses
      // intentionally (deferred-execution callbacks closing over later-
      // declared functions, setState calls inside effects). Runtime
      // behavior is correct; revisit if/when we refactor the affected
      // components (Authentication, SettingsSection, TransactionRequest,
      // Home).
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Reanimated shared values are read/written from gesture worklets created
    // during render — the designed Reanimated pattern. react-hooks/refs
    // cannot distinguish a SharedValue from a React ref and flags it. Scoped
    // to the one gesture component; do not disable globally.
    files: ['src/components/request/SlideToApprove.tsx'],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
];
