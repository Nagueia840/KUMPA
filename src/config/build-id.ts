/**
 * BUILD_ID del worker — trazabilidad objetiva de qué bundle corre en producción.
 *
 * Representación: hash SHA-256 determinístico del SOURCE TREE RELEVANTE del
 * worker (src/** + entry de la Edge Function + build script) calculado por
 * `scripts/build-kumpa-worker.mjs` ANTES de empaquetar, e inyectado como
 * constante vía `--define` de esbuild.
 *
 * NO es el SHA del bundle (sería circular: el bundle contendría su propio hash).
 * Es el hash del código fuente que genera el bundle: dos builds del mismo
 * source producen el MISMO BUILD_ID, y cualquier cambio de source lo cambia.
 *
 * En logs del worker aparece como:  [worker] build=<BUILD_ID>
 * No contiene secretos y no se muestra al usuario final.
 */
export const KUMPA_BUILD_ID: string =
  typeof __KUMPA_BUILD_ID__ !== 'undefined' ? __KUMPA_BUILD_ID__ : 'dev-local';
