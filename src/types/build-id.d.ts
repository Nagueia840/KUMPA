/**
 * Declaración de la constante global inyectada por esbuild en el bundle del
 * worker (scripts/build-kumpa-worker.mjs usa `--define:__KUMPA_BUILD_ID__=...`).
 * En desarrollo/typecheck la constante no existe → build-id.ts cae a 'dev-local'.
 */
declare const __KUMPA_BUILD_ID__: string;
