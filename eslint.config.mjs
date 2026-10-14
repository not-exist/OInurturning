import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name=/.*Unsafe$/]",
          message: '禁止 $queryRawUnsafe/$executeRawUnsafe：只允许模板字符串形式的参数化原始查询',
        },
      ],
    },
  },
);
