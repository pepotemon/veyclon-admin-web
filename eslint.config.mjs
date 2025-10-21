import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Base Next + TS
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Ignorar artefactos de build
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },

  // Reglas fuertes en archivos ya migrados (sin `any`)
  {
    files: [
      "src/app/(protected)/caja/page.tsx",
      "src/components/filters/GlobalFilters.tsx",
      "src/lib/firestoreQueries.ts",
      "src/lib/tz.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Overrides **temporales** para archivos aún por tipar
  // (desactiva `no-explicit-any` sólo aquí para no bloquear el deploy)
  {
    files: [
      "src/app/(protected)/rutas/page.tsx",
      "src/app/api/**/route.ts",
      "src/lib/alerts.ts",
      "src/lib/audit.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default eslintConfig;
