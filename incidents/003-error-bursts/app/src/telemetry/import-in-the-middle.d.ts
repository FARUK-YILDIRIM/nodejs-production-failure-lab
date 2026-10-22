// The package ships `register-hooks.d.ts`, but TypeScript looks for `.d.mts`
// next to an `.mjs` entry point, so point it at the existing declarations.
declare module 'import-in-the-middle/register-hooks.mjs' {
  export * from 'import-in-the-middle/register-hooks.js';
}
