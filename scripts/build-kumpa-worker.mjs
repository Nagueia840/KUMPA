// KUMPA — build reproducible del Edge Worker para Supabase.
// Lee el source canónico (supabase/functions/kumpa-worker/index.ts) y genera
// un bundle autocontenido (sin imports relativos) listo para deploy CLI.
//
// Uso:  node scripts/build-kumpa-worker.mjs
// Salida: supabase/functions/kumpa-worker/index.bundle.js
//
// BUILD_ID (trazabilidad de versión): hash SHA-256 determinístico del SOURCE
// TREE RELEVANTE (src/**/*.ts + entry de la Edge Function + este script),
// calculado ANTES de empaquetar e inyectado con --define en la constante
// KUMPA_BUILD_ID. NO es el SHA del bundle (evita el problema circular: el
// bundle contendría su propio hash); dos builds del mismo source producen el
// MISMO BUILD_ID, y cualquier cambio de source lo cambia. En logs del worker
// aparece como: [worker] build=<BUILD_ID>.
//
// Por qué bundle: el motor usa specifiers `.js` para archivos `.ts` (convención
// Node/tsc). Deno/el bundler eszip de Supabase NO resuelve `.js` -> `.ts`
// (docs oficiales; sloppy-imports es inestable y off por defecto). esbuild sí lo
// resuelve. Los `--alias` reescriben bare specifiers a `npm:` URLs, que el
// runtime de Supabase resuelve nativamente => el bundle no necesita import map.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
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

// ── BUILD_ID: hash determinístico del source tree relevante ─────────────────
function listTsFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.ts') || name.endsWith('.d.ts')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

const buildInputs = [
  ...listTsFiles(join(root, 'src')),
  entry,
  join(root, 'scripts/build-kumpa-worker.mjs'),
];
const hash = createHash('sha256');
for (const f of buildInputs) {
  hash.update(relative(root, f).replace(/\\/g, '/'));
  hash.update('\0');
  hash.update(readFileSync(f));
}
const buildId = hash.digest('hex');

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
  `--define:__KUMPA_BUILD_ID__="${buildId}"`,
  '--outfile=' + outfile,
  '--log-level=warning',
], { stdio: 'inherit' });

const size = statSync(outfile).size;
console.log('BUILD_ID: ' + buildId);
console.log('BUNDLE OK: ' + outfile);
console.log('bytes: ' + size);
console.log('KB: ' + (size / 1024).toFixed(2));
