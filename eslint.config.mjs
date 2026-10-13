import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/.pnpm/', '**/dist/', '**/coverage/', '**/src/generated/'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/.*Unsafe$/]',
          message: '禁止 $queryRawUnsafe/$executeRawUnsafe：只允许模板字符串形式的参数化原始查询',
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
