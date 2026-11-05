import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const lock = readJson(join(root, 'package-lock.json')).packages;
const { version, dependencies } = readJson(join(root, 'packages/mcp/package.json'));
const name = 'brainded-mcp';
const output = resolve(process.argv[2] ?? join(root, '.release'));
const tarball = join(output, `${name}-${version}.tgz`);
if (process.argv.length > 3) throw new Error('Usage: npm run package:mcp -- [output-directory]');
if (!process.env.npm_execpath) throw new Error('Run this script through npm run package:mcp');
if (existsSync(tarball)) throw new Error(`Release already exists: ${tarball}`);

// Find the runtime workspace graph and pin only its external npm dependencies.
// Native modules and platform-specific optional dependencies stay with npm.
const workspaces = new Map();
const external = new Map();
function visit(deps) {
  for (const spec of Object.keys(deps ?? {})) {
    if (workspaces.has(spec) || external.has(spec)) continue;
    const entry = lock[`node_modules/${spec}`];
    if (!entry) throw new Error(`Missing lock entry for ${spec}`);
    if (entry.link && spec.startsWith('@brain/')) {
      const directory = join(root, entry.resolved);
      workspaces.set(spec, join(directory, 'src/index.ts'));
      visit(readJson(join(directory, 'package.json')).dependencies);
    } else {
      if (!entry.version) throw new Error(`Cannot package external dependency ${spec}`);
      external.set(spec, entry.version);
    }
  }
}
visit(dependencies);

const tempRoot = realpathSync(tmpdir());
const stage = mkdtempSync(join(tempRoot, 'brainded-pack-'));
try {
  mkdirSync(output, { recursive: true });
  mkdirSync(join(stage, 'dist'));
  mkdirSync(join(stage, 'migrations'));
  const migrations = join(root, 'packages/storage/migrations');
  for (const file of readdirSync(migrations).filter(file => /^\d+_[\w-]+\.sql$/.test(file))) {
    copyFileSync(join(migrations, file), join(stage, 'migrations', file));
  }
  copyFileSync(join(root, 'scripts/installer-readme.md'), join(stage, 'README.md'));
  writeFileSync(join(stage, 'package.json'), JSON.stringify({
    name, version, description: 'Brainded local memory MCP server', type: 'module',
    bin: { 'brain-mcp': './dist/cli.js' }, engines: { node: '>=24' },
    files: ['dist/cli.js', 'migrations/*.sql'],
    dependencies: Object.fromEntries([...external].sort(([a], [b]) => a.localeCompare(b))),
  }, null, 2) + '\n');

  await build({
    entryPoints: [join(root, 'packages/mcp/src/cli.ts')],
    outfile: join(stage, 'dist/cli.js'),
    bundle: true, platform: 'node', target: 'node24', format: 'esm', minify: true,
    external: [...external.keys()],
    plugins: [{
      name: 'workspace-source',
      setup(builder) {
        builder.onResolve({ filter: /^@brain\// }, ({ path }) => {
          const entry = workspaces.get(path);
          if (!entry) throw new Error(`Undeclared workspace import ${path}`);
          return { path: entry };
        });
      },
    }],
  });

  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--json', '--pack-destination', output], {
    cwd: stage, encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'npm pack failed');
  const [pack] = JSON.parse(result.stdout);
  console.log(JSON.stringify({ tarball, bytes: pack.size, files: pack.files.map(file => file.path) }, null, 2));
} finally {
  const relativeStage = relative(tempRoot, realpathSync(stage));
  if (!isAbsolute(relativeStage) && /^brainded-pack-[^/\\]+$/.test(relativeStage)) {
    rmSync(stage, { recursive: true, force: true });
  }
}
