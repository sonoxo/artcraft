export default [
  // The desktop has a dedicated test config; loading its build config as well
  // registers the same package twice and prevents the workspace from starting.
  'apps/artcraft/vitest.config.{mjs,js,ts,mts}',
  'libs/**/vite.config.{mjs,js,ts,mts}',
];
