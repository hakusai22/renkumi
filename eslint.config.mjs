import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    ignores: [".next/**", ".remotion/**", "node_modules/**", "public/renders/**", "public/assets/generated/**"],
  },
];

export default eslintConfig;
