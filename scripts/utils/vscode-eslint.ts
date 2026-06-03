import { join } from 'node:path';

export interface VSCodeGalleryExtension {
  versions: {
    version: string;
    flags: string;
  }[];
}

export async function getLatestVSCodeESLintVersion(): Promise<string> {
  const res = await fetch(
    'https://marketplace.visualstudio.com/_apis/public/gallery/vscode/dbaeumer/vscode-eslint/latest',
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch VSCode ESLint metadata from marketplace: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as VSCodeGalleryExtension;

  const version = data.versions.find((v) => !v.flags.includes('prerelease'))?.version;

  if (!version) {
    throw new Error(
      'Failed to determine latest stable VSCode ESLint version: no non-prerelease version found in response',
    );
  }

  return version;
}

export async function downloadVSCodeESLintLanguageServer(version: string, outDir: string): Promise<void> {
  const url = `https://dbaeumer.vscode-unpkg.net/dbaeumer/vscode-eslint/${version}/extension/server/out/eslintServer.js`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to download ESLint language server from ${url}: ${res.status} ${res.statusText}`);
  }

  await Bun.write(join(outDir, 'eslintServer.cjs'), res);
}
