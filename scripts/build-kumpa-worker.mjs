// KUMPA — build reproducible del Edge Worker para Supabase.
// Lee el source canónico (supabase/functions/kumpa-worker/index.ts) y genera
// un bundle autocontenido (sin imports relativos) listo para deploy CLI.
//
// Uso:  node scripts/build-kumpa-worker.mjs
// Salida: supabase/functions/kumpa-worker/index.bundle.js
//
// Por qué bundle: el motor usa specifiers `.js` para archivos `.ts` (convención
// Node/tsc). Deno/el bundler eszip de Supabase NO resuelve `.js` -> `.ts`
// (docs oficiales; sloppy-imports es inestable y off por defecto). esbuild sí lo
// resuelve. Los `--alias` reescriben bare specifiers a `npm:` URLs, que el
// runtime de Supabase resuelve nativamente => el bundle no necesita import map.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const entry = join(root, 'supabase/functions/kumpa-worker/index.ts');
const outfile = join(root, 'supabase/functions/kumpa-worker/index.bundle.js');
let esbuildBin = join(root, 'node_modules/@esbuild/win32-x64/esbuild.exe');
if (!existsSync(esbuildBin)) {
  // fallback: binario de la plataforma actual vía require.resolve
  const pkg = join(root, 'node_modules/esbuild/package.json');
  const pkgJson = JSON.parse(readFileSync(pkg, 'utf8'));
  esbuildBin = join(root, 'node_modules', pkgJson.bin.esbuild || 'esbuild');
}

if (!existsSync(entry)) {
  console.error('ENTRY NO EXISTE: ' + entry);
  process.exit(1);
}

// stdio inherit: el sandbox bloquea pipes de child_process, no inherit.
// Sin shell: la ruta contiene espacios y shell=true los rompería (cmd).
execFileSync(esbuildBin, [
  entry,
  '--bundle',
  '--format=esm',
  '--platform=neutral',
  '--packages=external',
  '--alias:grammy=npm:grammy@1.30.0',
  '--alias:openai=npm:openai@4.69.0',
  '--alias:zod=npm:zod@3.23.8',
  '--alias:viem=npm:viem@2.21.0',
  '--alias:viem/chains=npm:viem@2.21.0/chains',
  '--alias:@supabase/supabase-js=npm:@supabase/supabase-js@2.45.0',
  '--outfile=' + outfile,
  '--log-level=warning',
], { stdio: 'inherit' });

const size = statSync(outfile).size;
console.log('BUNDLE OK: ' + outfile);
console.log('bytes: ' + size);
console.log('KB: ' + (size / 1024).toFixed(2));
