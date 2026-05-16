import fs from 'node:fs';
import { join } from 'node:path';

import { format } from 'oxfmt';

import { downloadVSCodeESLintLanguageServer, getLatestVSCodeESLintVersion } from './vscode-eslint.ts';
import { extractVSCodeLanguageServers, getLatestVSCodeVersion, patchVSCodeHtmlLanguageServer } from './vscode.ts';

interface PackageJson {
  upstream: {
    vscode: string;
    'vscode-eslint': string;
  };
}

const packageJsonPath = join(import.meta.dir, '..', 'package.json');
const distPath = join(import.meta.dir, '..', 'dist');
const packageJson = (await Bun.file(packageJsonPath).json()) as PackageJson;

if (Bun.argv.includes('--update')) {
  console.info('Checking upstream versions...');

  const [vscode, vscodeEslint] = await Promise.all([getLatestVSCodeVersion(), getLatestVSCodeESLintVersion()]);

  const vscodeUpdated = packageJson.upstream.vscode !== vscode;
  const vscodeEslintUpdated = packageJson.upstream['vscode-eslint'] !== vscodeEslint;

  console.info(`VS Code: ${packageJson.upstream.vscode}${vscodeUpdated ? ` -> ${vscode}` : ' (up to date)'}`);
  console.info(
    `VS Code ESLint: ${packageJson.upstream['vscode-eslint']}${vscodeEslintUpdated ? ` -> ${vscodeEslint}` : ' (up to date)'}`,
  );

  packageJson.upstream.vscode = vscode;
  packageJson.upstream['vscode-eslint'] = vscodeEslint;

  const { code, errors } = await format(packageJsonPath, JSON.stringify(packageJson), { sortPackageJson: true });

  if (errors.length !== 0) {
    throw new Error(`Failed to format package.json: ${errors.map((error) => error.message).join(', ')}`);
  }

  await Bun.write(packageJsonPath, code);

  if (vscodeUpdated || vscodeEslintUpdated) {
    console.info('Updated package.json with new versions');
  } else {
    console.info('No updates needed');
  }
}

fs.rmSync(distPath, { recursive: true, force: true });

console.info(`Downloading VS Code ESLint language server ${packageJson.upstream['vscode-eslint']} to ${distPath}`);
await downloadVSCodeESLintLanguageServer(packageJson.upstream['vscode-eslint'], distPath);

console.info(`Extracting VS Code language servers ${packageJson.upstream.vscode} to ${distPath}`);
await extractVSCodeLanguageServers(packageJson.upstream.vscode, distPath);

console.info('Patching VS Code HTML language server');
await patchVSCodeHtmlLanguageServer(join(distPath, 'htmlServerMain.js'));

console.info('Validating imports in extracted files');
{
  const transpiler = new Bun.Transpiler({ loader: 'js' });

  for await (const file of new Bun.Glob('**/*.{js,cjs}').scan(distPath)) {
    const filePath = join(distPath, file);
    const { imports } = transpiler.scan(await Bun.file(filePath).text());

    for (const imp of imports) {
      try {
        import.meta.resolve(imp.path);
      } catch {
        throw new Error(`Cannot resolve import '${imp.path}' in ${file}`);
      }
    }

    console.info(`[ok] ${file}`);
  }
}

console.info('Done');
