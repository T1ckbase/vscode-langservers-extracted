import { chmod, cp, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

type Repo = (typeof REPOS)[number];

const NO_UPDATES_EXIT_CODE = 2;
const REPOS = ['microsoft/vscode', 'microsoft/vscode-eslint'] as const;
const FORCE = process.argv.includes('--force');

async function writeExecutable(path: string, text: string): Promise<void> {
  const withShebang = text.startsWith('#!') ? text : `#!/usr/bin/env node\n${text}`;
  await Bun.write(path, withShebang);
  await chmod(path, 0o755);
}

async function getLatestReleaseVersion(repo: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      ...(Bun.env.GITHUB_TOKEN
        ? {
            Authorization: `Bearer ${Bun.env.GITHUB_TOKEN}`,
          }
        : {}),
    },
  });
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

async function extractVscode(version: string): Promise<void> {
  console.log(`Downloading microsoft/vscode v${version}...`);

  // https://code.visualstudio.com/Docs/supporting/FAQ
  const res = await fetch(`https://update.code.visualstudio.com/${version}/linux-x64/stable`);
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
      if (name === entrypoint) {
        entrypointFound = true;
        await writeExecutable(join(`./dist/${language}`, name), text);
      } else {
        await Bun.write(join(`./dist/${language}`, name), text);
      }
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

  const res = await fetch(getVsixUrl('dbaeumer', 'vscode-eslint', version));
  if (!res.ok) throw new Error(`Failed to download vscode-eslint: ${res.status} ${res.statusText}`);
  await Bun.write('./tmp/vscode-eslint.vsix', await res.blob());

  await rm('./tmp/vscode-eslint', { recursive: true, force: true });
  await Bun.$`unzip -oq ./tmp/vscode-eslint.vsix -d ./tmp/vscode-eslint`;
  await cp('./tmp/vscode-eslint/extension/server/out', './dist/eslint', { recursive: true });

  const serverFile = Bun.file('./dist/eslint/eslintServer.js');
  await writeExecutable('./dist/eslint/eslintServer.js', await serverFile.text());
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

  const updates = REPOS.filter((repo) => {
    const isUpdate = packageJson.metadata.versions[repo] !== latestVersions[repo];
    console.log(
      isUpdate
        ? `Update available for ${repo}: ${packageJson.metadata.versions[repo]} -> ${latestVersions[repo]}`
        : `${repo} is already at latest version (${latestVersions[repo]})`,
    );
    return isUpdate;
  });

  if (updates.length === 0) {
    console.log('---');
    if (!FORCE) {
      console.log('All packages are already up to date. Nothing to do.');
      process.exit(NO_UPDATES_EXIT_CODE);
    }
    console.log('All packages are already up to date. Downloading and extracting anyway because --force was passed.');
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
