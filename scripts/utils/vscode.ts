import { join } from 'node:path';

export interface VSCodeUpdateInfo {
  url: string;
  name: string;
  version: string;
  productVersion: string;
  hash: string;
  timestamp: number;
  sha256hash: string;
  supportsFastUpdate: boolean;
  notes: string;
}

export async function getVSCodeUpdateInfo(): Promise<VSCodeUpdateInfo> {
  const res = await fetch('https://update.code.visualstudio.com/api/update/linux-x64/stable/latest');

  if (!res.ok) throw new Error(`Failed to fetch VSCode update info: ${res.status} ${res.statusText}`);

  return (await res.json()) as VSCodeUpdateInfo;
}

export async function getLatestVSCodeVersion() {
  return (await getVSCodeUpdateInfo()).productVersion;
}

// Old VS Code versions do not exist on the CDN
// export async function downloadVSCodeLanguageServers(version: string, outDir: string) {
//   for (const language of ['css', 'html', 'json']) {
//     const fileName = `${language}ServerMain.js`;
//
//     const url = `https://main.vscode-cdn.net/stable/${version}/extensions/${language}-language-features/server/dist/node/${fileName}`;
//
//     const res = await fetch(url);
//
//     if (!res.ok) {
//       throw new Error(
//         `Failed to download ${language} language server (${fileName}) from ${url}: ${res.status} ${res.statusText}`,
//       );
//     }
//
//     await Bun.write(join(outDir, fileName), res);
//   }
// }

export async function extractVSCodeLanguageServers(version: string, outDir: string) {
  // https://code.visualstudio.com/Docs/supporting/FAQ
  const res = await fetch(`https://update.code.visualstudio.com/${version}/linux-x64/stable`);

  if (!res.ok) throw new Error(`Failed to download VS Code ${version}: ${res.status} ${res.statusText}`);

  const archive = new Bun.Archive(await res.blob());

  for (const language of ['css', 'html', 'json']) {
    const fileName = `${language}ServerMain.js`;

    const files = await archive.files(`**/extensions/${language}-language-features/server/dist/node/${fileName}`);

    if (files.size !== 1) throw new Error(`Expected 1 file for ${language}, got ${files.size}`);

    const [, file] = files.entries().next().value!;
    await Bun.write(join(outDir, fileName), file);
  }
}

/**
 * Patches hardcoded TypeScript paths in the VSCode HTML language server bundle
 * to use import.meta.resolve for dynamic path resolution, and updates the lib target to ESNext.
 */
export async function patchVSCodeHtmlLanguageServer(serverPath: string) {
  let text = await Bun.file(serverPath).text();

  // Insert fileURLToPath import after the path import line
  {
    const insertAfter = 'import{join as tm,basename as uA,dirname as Qp}from"path";';
    const insertion = 'import { fileURLToPath as __injected_fileURLToPath } from "node:url";';
    const count = text.split(insertAfter).length - 1;
    if (count !== 1) throw new Error(`Expected exactly 1 occurrence of insert-anchor, found ${count}`);
    text = text.replace(insertAfter, `${insertAfter}${insertion}`);
  }

  // Replace hardcoded TypeScript lib path with runtime resolution via import.meta.resolve
  {
    const from = 'tm(c2,"../../node_modules/typescript/lib")';
    const to = 'Qp(__injected_fileURLToPath(import.meta.resolve("typescript/lib/lib.d.ts")))';
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`Expected exactly 1 occurrence of TypeScript path, found ${count}`);
    text = text.replace(from, to);
  }

  // Update TypeScript lib target to ESNext
  {
    const from = 'lib:["lib.es2020.full.d.ts"]';
    const to = 'lib:["lib.esnext.full.d.ts"]';
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`Expected exactly 1 occurrence of TypeScript lib configuration, found ${count}`);
    text = text.replace(from, to);
  }

  // {
  //   const from = 'a=`${Zl}://${e}/libs/`;';
  //   const to = 'a=new URL(".", import.meta.resolve("typescript/lib/lib.d.ts")).href;';
  //   const count = text.split(from).length - 1;
  //   if (count !== 1) throw new Error(`Expected exactly 1 occurrence of libs base URI, found ${count}`);
  //   text = text.replace(from, to);
  // }

  await Bun.write(serverPath, text);
}
