import fs from 'node:fs/promises';
import { join } from 'node:path';

import { format } from 'oxfmt';

interface Upstream {
  vscode: { version: string; commit: string };
  'vscode-eslint': string;
}

function patch(code: string, pattern: RegExp, replacement: string): string {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const matches = [...code.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) throw new Error(`Patch failed: no match found for ${pattern}`);
  if (matches.length > 1) throw new Error(`Patch failed: expected 1 match for ${pattern}, found ${matches.length}`);
  return code.replace(pattern, replacement);
}

if (Bun.argv.includes('--update')) {
  console.log('Checking upstream versions...');

  const [vscodeRes, eslintRes] = await Promise.all([
    fetch('https://update.code.visualstudio.com/api/update/linux-x64/stable/latest'),
    fetch('https://marketplace.visualstudio.com/_apis/public/gallery/vscode/dbaeumer/vscode-eslint/latest'),
  ]);

  if (!vscodeRes.ok) throw new Error(`Failed to fetch VS Code: ${vscodeRes.status} ${vscodeRes.statusText}`);
  if (!eslintRes.ok) throw new Error(`Failed to fetch ESLint: ${eslintRes.status} ${eslintRes.statusText}`);

  const vscodeData = (await vscodeRes.json()) as { version: string; productVersion: string };
  const eslintData = (await eslintRes.json()) as {
    versions: { version: string; properties: { key: string; value: string }[] }[];
  };
  const latestESLint = eslintData.versions.find(
    (v) => !v.properties?.some((p) => p.key === 'Microsoft.VisualStudio.Code.PreRelease' && p.value === 'true'),
  )?.version;
  if (!latestESLint) throw new Error('No stable ESLint version found');

  const upstream = (await Bun.file('./upstream.json').json()) as Upstream;
  const vscodeUpdated =
    upstream.vscode.version !== vscodeData.productVersion || upstream.vscode.commit !== vscodeData.version;
  const eslintUpdated = upstream['vscode-eslint'] !== latestESLint;

  console.log(
    `VS Code: ${upstream.vscode.version} (${upstream.vscode.commit.slice(0, 7)})${vscodeUpdated ? ` -> ${vscodeData.productVersion} (${vscodeData.version.slice(0, 7)})` : ' (up to date)'}`,
  );
  console.log(`VS Code ESLint: ${upstream['vscode-eslint']}${eslintUpdated ? ` -> ${latestESLint}` : ' (up to date)'}`);

  if (!vscodeUpdated && !eslintUpdated) {
    console.log('No updates needed');
    process.exit(0);
  }

  upstream.vscode = { version: vscodeData.productVersion, commit: vscodeData.version };
  upstream['vscode-eslint'] = latestESLint;

  const { code, errors } = await format('./upstream.json', JSON.stringify(upstream, null, 2));
  if (errors.length !== 0)
    throw new Error(`Failed to format upstream.json: ${errors.map((e) => e.message).join(', ')}`);

  await Bun.write('./upstream.json', code);
  console.log('Updated upstream.json with latest versions');
}

const upstream = (await Bun.file('./upstream.json').json()) as Upstream;

await fs.rm('dist', { recursive: true, force: true });
await fs.mkdir('dist', { recursive: true });

console.log(
  `Downloading VS Code language servers (${upstream.vscode.version}, ${upstream.vscode.commit.slice(0, 7)})...`,
);
for (const lang of ['css', 'html', 'json']) {
  const file = `${lang}ServerMain.js`;
  const url = `https://main.vscode-cdn.net/stable/${upstream.vscode.commit}/extensions/${lang}-language-features/server/dist/node/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${file}: ${res.status} ${res.statusText}`);
  await Bun.write(join('dist', file), res);
}

console.log(`Downloading VS Code ESLint language server (${upstream['vscode-eslint']})...`);
{
  const eslintUrl = `https://dbaeumer.vscode-unpkg.net/dbaeumer/vscode-eslint/${upstream['vscode-eslint']}/extension/server/out/eslintServer.js`;
  const eslintRes = await fetch(eslintUrl);
  if (!eslintRes.ok) throw new Error(`Failed to download ESLint: ${eslintRes.status} ${eslintRes.statusText}`);
  await Bun.write(join('dist', 'eslintServer.cjs'), eslintRes);
}

console.log('Patching VS Code HTML language server...');
{
  const htmlPath = join('dist', 'htmlServerMain.js');
  let code = await Bun.file(htmlPath).text();

  code = `import { fileURLToPath as ___fileURLToPath } from 'node:url';\nimport { dirname as ___dirname } from 'node:path';\n${code}`;

  // Replace hardcoded TypeScript lib path with runtime resolution via import.meta.resolve
  code = patch(
    code,
    /\w+\(\w+,"\.\.\/\.\.\/node_modules\/typescript\/lib"\)/,
    '___dirname(___fileURLToPath(import.meta.resolve("typescript/lib/lib.d.ts")))',
  );

  // Update TypeScript lib target to ESNext
  code = patch(code, /lib:\["lib\.es2020\.full\.d\.ts"\]/, 'lib:["lib.esnext.full.d.ts"]');

  // Replace VS Code's virtual libs URI with file URI
  code = patch(
    code,
    /`\$\{\w+\}:\/\/\$\{\w+\}\/libs\/`/,
    'new URL(".", import.meta.resolve("typescript/lib/lib.d.ts")).href',
  );

  await Bun.write(htmlPath, code);
}

console.log('Checking imports in extracted files...');
{
  const transpiler = new Bun.Transpiler({ loader: 'js' });

  for await (const file of new Bun.Glob('**/*.{js,cjs}').scan('dist')) {
    const filePath = join('dist', file);
    const { imports } = transpiler.scan(await Bun.file(filePath).text());

    for (const imp of imports) {
      try {
        import.meta.resolve(imp.path);
      } catch {
        throw new Error(`Cannot resolve import '${imp.path}' in ${file}`);
      }
    }
  }
}
