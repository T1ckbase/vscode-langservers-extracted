import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { $ } from 'bun';
import packageJson from './package.json' with { type: 'json' };

interface GitHubApiResponse {
  tag_name: string;
  [key: string]: any;
}

async function getFileHash(path: string): Promise<string> {
  const file = Bun.file(path);
  const hasher = new Bun.CryptoHasher('sha256');
  const buffer = await file.arrayBuffer();
  hasher.update(buffer);
  return hasher.digest('hex');
}

async function getLatestVscodeVersion() {
  const res = await fetch('https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-archive', {
    method: 'HEAD',
    redirect: 'follow',
  });
  console.log(res.url);
  const found = res.url.match(/(\d+\.\d+\.\d+)(?=\.zip)/);
  if (!found) throw Error('Unable to parse the latest VSCode version');
  return found[0];
}

async function getLatestVscodeEslintVersion() {
  const res = await fetch('https://api.github.com/repos/microsoft/vscode-eslint/releases/latest');
  if (!res.ok) throw Error(`Failed to fetch latest vscode-eslint version: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as GitHubApiResponse;
  const found = data.tag_name.match(/\d+\.\d+\.\d+$/);
  if (!found) throw Error('Unable to parse the latest vscode-eslint version');
  return found[0];
}

async function getLatestVscodeAnycodeVersion() {
  const res = await fetch('https://api.github.com/repos/microsoft/vscode-anycode/releases/latest');
  if (!res.ok) throw Error(`Failed to fetch latest vscode-anycode version: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as GitHubApiResponse;
  const found = data.tag_name.match(/\d+\.\d+\.\d+$/);
  if (!found) throw Error('Unable to parse the latest vscode-anycode version');
  return found[0];
}

async function githubApiGetLatestReleaseVersion(repo: string, regex: RegExp) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
  if (!res.ok) throw Error(`Failed to fetch latest ${repo} version: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as GitHubApiResponse;
  const found = data.tag_name.match(regex);
  if (!found) throw Error(`Unable to parse the latest ${repo} version`);
  return found[0];
}

async function getVsixUrl(extensionName: string) {
  const [publisher, name] = extensionName.split('.');
  if (!publisher || !name) throw new Error(`Invalid extension name: "${extensionName}". Format must be "publisher.extension".`);
  return `https://${publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/${publisher}/extension/${name}/latest/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`;
}

async function downloadVsix(extensionName: string) {
  const [publisher, name] = extensionName.split('.');
  if (!publisher || !name) throw new Error(`Invalid extension name: "${extensionName}". Format must be "publisher.extension".`);

  const url = `https://${publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/${publisher}/extension/${name}/latest/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`;
  const res = await fetch(url);
  if (!res.ok) throw Error(`Failed to download VSIX for "${extensionName}". ${res.status} ${res.statusText}`);
  return await res.arrayBuffer();
}

async function getVscodeExtensionsPackageJson(version: string) {
  const res = await fetch(`https://raw.githubusercontent.com/microsoft/vscode/refs/tags/${version}/extensions/package.json`);
  if (!res.ok) throw Error(`Failed to fetch vscode extensions package.json: ${res.status} ${res.statusText}`);
  return (await res.json()) as any;
}

interface Package {
  repo: string;
  checkver: RegExp;
  downloadUrl: string | ((version: string) => string);
  copy: Record<string, string>;
  entries: string[];
}

const packages: Package[] = [
  {
    repo: 'microsoft/vscode',
    checkver: /\d+\.\d+\.\d+$/,
    downloadUrl: 'https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-archive',
    copy: {
      'resources/app/extensions/css-language-features/server/dist/node/*': 'dist/css/',
      'resources/app/extensions/html-language-features/server/dist/node/*': 'dist/html/',
      'resources/app/extensions/json-language-features/server/dist/node/*': 'dist/json/',
    },
    entries: ['dist/css/cssServerMain.js', 'dist/html/htmlServerMain.js', 'dist/json/jsonServerMain.js'],
  },
  {
    repo: 'microsoft/vscode-anycode',
    checkver: /\d+\.\d+\.\d+$/,
    downloadUrl: (version) =>
      `https://ms-vscode.gallery.vsassets.io/_apis/public/gallery/publisher/ms-vscode/extension/anycode/${version}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`,
    copy: {
      'extension/dist/anycode.server.node.js': 'dist/anycode/',
    },
    entries: ['dist/anycode/anycode.server.node.js'],
  },
  {
    repo: 'microsoft/vscode-eslint',
    checkver: /\d+\.\d+\.\d+$/,
    downloadUrl: (version) =>
      `https://dbaeumer.gallery.vsassets.io/_apis/public/gallery/publisher/dbaeumer/extension/vscode-eslint/${version}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`,
    copy: {
      'extension/server/out/*': 'dist/eslint/',
    },
    entries: ['dist/eslint/eslintServer.js'],
  },
] as const;

$.cwd(os.tmpdir());

const updates: string[] = [];
for (const pkg of packages) {
  const latestVersion = await githubApiGetLatestReleaseVersion(pkg.repo, pkg.checkver);
  const currentVersion = packageJson.metadata.versions[pkg.repo as keyof typeof packageJson.metadata.versions];
  if (typeof currentVersion !== 'string') throw Error('?');
  if (currentVersion === latestVersion) continue;

  if (pkg.repo === 'microsoft/vscode') {
    const vscodeExtensionsPackageJson = await getVscodeExtensionsPackageJson(latestVersion);
    packageJson.dependencies = vscodeExtensionsPackageJson.dependencies;
  }

  console.log(`Downloading ${pkg.repo}...`);
  await $`curl -fsSL ${typeof pkg.downloadUrl === 'string' ? pkg.downloadUrl : pkg.downloadUrl(latestVersion)} -o tmp.zip`;
  await $`unzip -q tmp.zip -d tmp`;
  for (const [k, v] of Object.entries(pkg.copy)) {
    await $`mkdir -p ${v}`;
    await $`cp ${path.join('tmp', k)} ${v}`;
  }
  for (const entry of pkg.entries) {
    const file = Bun.file(path.join(os.tmpdir(), entry));
    if (!(await file.exists())) throw Error('Entry not found');
    $`sed -i '1i #!/usr/bin/env node' ${entry}`;
  }
  await $`rm -r tmp`;

  updates.push(`${pkg.repo} ${currentVersion} → ${latestVersion}`);
  packageJson.metadata.versions[pkg.repo as keyof typeof packageJson.metadata.versions] = latestVersion;
}

await Bun.write('package.json', JSON.stringify(packageJson, null, 2));

$.cwd(process.cwd());
$`mkdir dist`;
$`mv ${path.join(os.tmpdir(), 'dist')} ${process.cwd()}`;
$`npm version patch -m "chore: update vscode language servers: ${updates.join(', ')}"`;
$`npm publish --provenance --access public --dry-run`;

console.log(packageJson);

// const vscodeVersion = await getLatestVscodeVersion();
// const vscodeEslintVersion = await githubApiGetLatestReleaseVersion('microsoft/vscode-eslint');
// const vscodeAnycodeVersion = await githubApiGetLatestReleaseVersion('microsoft/vscode-anycode');
// if (
//   Bun.semver.order(vscodeVersion, packageJson.metadata.versions['microsoft/vscode']) !== 1 &&
//   Bun.semver.order(vscodeEslintVersion, packageJson.metadata.versions['microsoft/vscode-eslint']) !== 1 &&
//   Bun.semver.order(vscodeAnycodeVersion, packageJson.metadata.versions['microsoft/vscode-anycode']) !== 1
// ) {
//   console.log('No updates available');
//   const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;
//   if (GITHUB_OUTPUT) {
//     await Bun.write(GITHUB_OUTPUT, 'update=false');
//     process.exit(0);
//   }
// }

// const eslintPath = path.join(os.tmpdir(), 'vscode-eslint.zip');
// // await Bun.write(eslintPath, await downloadVsix('dbaeumer.vscode-eslint'));
// $.cwd(os.tmpdir());
// await $`curl -fsSL https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-archive -o vscode.zip`;
// await $`unzip -q vscode.zip -d vscode`;
// console.log(await $`unzip -q vscode-eslint.zip -d vscode-eslint`);
