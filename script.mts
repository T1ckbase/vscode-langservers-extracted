import { cp, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

type Repo = (typeof REPOS)[number];

const NO_UPDATES_EXIT_CODE = 2;
const REPOS = ['microsoft/vscode', 'microsoft/vscode-eslint'] as const;
const FORCE = process.argv.includes('--force');

function addNodeShebang(text: string): string {
  return text.startsWith('#!/usr/bin/env node\n') ? text : `#!/usr/bin/env node\n${text}`;
}

async function getLatestReleaseVersion(repo: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
  if (!res.ok) throw new Error(`Failed to fetch the latest release for ${repo}: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as { tag_name?: string };
  const version = data.tag_name?.match(/\d+\.\d+\.\d+/)?.[0];
  if (!version) throw new Error(`Failed to parse a version number from the latest release tag for ${repo}`);

  return version;
}

async function getVscodeExtensionsDependencies(version: string): Promise<Record<string, string>> {
  const res = await fetch(`https://raw.githubusercontent.com/microsoft/vscode/${version}/extensions/package.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch VS Code extension dependencies for ${version}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { dependencies?: Record<string, string> };
  return data.dependencies ?? {};
}

function getVsixUrl(publisher: string, extension: string, version: string): string {
  return `https://${publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/${publisher}/extension/${extension}/${version}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`;
}

async function prependShebangToFile(path: string): Promise<void> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Expected file does not exist: ${path}`);
  }

  await Bun.write(path, addNodeShebang(await file.text()));
}

async function downloadVsix(url: string, archivePath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);

  await Bun.write(archivePath, await res.blob());
}

async function unzip(archivePath: string, outputDir: string): Promise<void> {
  await rm(outputDir, { recursive: true, force: true });
  await Bun.$`unzip -oq ${archivePath} -d ${outputDir}`;
}

async function extractVscode(version: string): Promise<void> {
  console.log(`Downloading microsoft/vscode v${version}...`);

  const res = await fetch('https://code.visualstudio.com/sha/download?build=stable&os=linux-x64');
  if (!res.ok) throw new Error(`Failed to download microsoft/vscode: ${res.status} ${res.statusText}`);

  const archive = new Bun.Archive(await res.blob());

  for (const language of ['css', 'html', 'json']) {
    const files = await archive.files(`**/${language}-language-features/server/dist/node/*`);
    const entrypoint = `${language}ServerMain.js`;
    let fileCount = 0;
    let entrypointFound = false;

    for (const [, file] of files) {
      fileCount += 1;

      const name = basename(file.name);
      const text = await file.text();
      const output = name === entrypoint ? addNodeShebang(text) : text;

      if (name === entrypoint) {
        entrypointFound = true;
      }

      await Bun.write(join(`./dist/${language}`, name), output);
    }

    if (fileCount === 0) {
      throw new Error(`No files were found for the ${language} language server in the VS Code archive`);
    }

    if (!entrypointFound) {
      throw new Error(`Could not find ${entrypoint} in the VS Code archive`);
    }
  }
}

async function extractEslint(version: string): Promise<void> {
  console.log(`Downloading microsoft/vscode-eslint v${version}...`);

  await downloadVsix(getVsixUrl('dbaeumer', 'vscode-eslint', version), './tmp/vscode-eslint.vsix');
  await unzip('./tmp/vscode-eslint.vsix', './tmp/vscode-eslint');

  await cp('./tmp/vscode-eslint/extension/server/out', './dist/eslint', { recursive: true });
  await prependShebangToFile('./dist/eslint/eslintServer.js');
}

async function main(): Promise<void> {
  const packageJson = (await Bun.file('./package.json').json()) as {
    dependencies: Record<string, string>;
    metadata: { versions: Record<Repo, string> };
  };

  console.log('Checking for updates...');
  const latestVersions = Object.fromEntries(
    await Promise.all(REPOS.map(async (repo) => [repo, await getLatestReleaseVersion(repo)] as const)),
  ) as Record<Repo, string>;

  const updates: string[] = [];

  for (const repo of REPOS) {
    const currentVersion = packageJson.metadata.versions[repo];
    const latestVersion = latestVersions[repo];

    if (currentVersion !== latestVersion) {
      updates.push(`${repo} ${currentVersion} -> ${latestVersion}`);
      console.log(`Update available for ${repo}: ${currentVersion} -> ${latestVersion}`);
      continue;
    }

    console.log(`${repo} is already at latest version (${latestVersion})`);
  }

  if (updates.length === 0) {
    if (FORCE) {
      console.log('---');
      console.log('All packages are already up to date. Rebuilding anyway because --force was passed.');
    } else {
      console.log('---');
      console.log('All packages are already up to date. Nothing to do.');
      process.exit(NO_UPDATES_EXIT_CODE);
    }
  }

  console.log('---');
  console.log('Downloading all packages...');
  await rm('./dist', { recursive: true, force: true });

  await extractVscode(latestVersions['microsoft/vscode']);
  await extractEslint(latestVersions['microsoft/vscode-eslint']);
  packageJson.dependencies = await getVscodeExtensionsDependencies(latestVersions['microsoft/vscode']);

  Object.assign(packageJson.metadata.versions, latestVersions);

  await Bun.write('./package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

  console.log('---');
  if (updates.length === 0) {
    console.log('Rebuilt packages without upstream version changes');
    return;
  }

  console.log(`Updated ${updates.length} package(s)`);
  for (const update of updates) {
    console.log(update);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
