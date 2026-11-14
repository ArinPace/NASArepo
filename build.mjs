// Build script: bundles the game into ONE self-contained HTML file.
//   node build.mjs           -> docs/index.html (GitHub Pages) and dist/index.html
//   node build.mjs --tests   -> bundles tests/*.test.ts into .cache/ for `node --test`
//   node build.mjs --serve   -> rebuilds on change and serves docs/ on http://localhost:8000
import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);

async function buildTests() {
  mkdirSync('.cache', { recursive: true });
  const files = readdirSync('tests').filter((f) => f.endsWith('.test.ts'));
  await build({
    entryPoints: files.map((f) => `tests/${f}`),
    outdir: '.cache',
    bundle: true,
    platform: 'node',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    logLevel: 'warning',
  });
}

const options = {
  entryPoints: ['src/main.tsx'],
  bundle: true,
  minify: true,
  write: false,
  outdir: 'out',
  format: 'iife',
  target: ['es2020'],
  loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
};

function emit(result) {
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/g, '<\\/script');
  const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
  const html = readFileSync('src/index.html', 'utf8')
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => js);
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/index.html', html);
  console.log(`built docs/index.html (${(html.length / 1024).toFixed(0)} kB)`);
}

if (args.includes('--tests')) {
  await buildTests();
} else if (args.includes('--serve')) {
  const ctx = await context({
    ...options,
    plugins: [{ name: 'emit', setup: (b) => b.onEnd((r) => r.errors.length === 0 && emit(r)) }],
  });
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: 'docs', port: 8000 });
  console.log(`serving http://${host}:${port}`);
} else {
  emit(await build(options));
}
