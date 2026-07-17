# VSCode Langservers Extracted

[![NPM Version](https://img.shields.io/npm/v/@t1ckbase/vscode-langservers-extracted?logo=npm&color=262626)](https://www.npmjs.com/package/@t1ckbase/vscode-langservers-extracted)
[![Release](https://github.com/T1ckbase/vscode-langservers-extracted/actions/workflows/release.yaml/badge.svg)](https://github.com/T1ckbase/vscode-langservers-extracted/actions/workflows/release.yaml)

A drop-in replacement for [@hrsh7th's `vscode-langservers-extracted`](https://github.com/hrsh7th/vscode-langservers-extracted).

The HTML, CSS, and JSON language servers are extracted from [VS Code](https://github.com/microsoft/vscode), while the ESLint language server is extracted from the [VS Code ESLint extension](https://github.com/microsoft/vscode-eslint). Markdown language server uses the official [`vscode-markdown-languageserver`](https://www.npmjs.com/package/vscode-markdown-languageserver) package.

## Patches

- HTML language server ([`scripts/utils/vscode.ts`](scripts/utils/vscode.ts)):
  - Fixed hardcoded TypeScript lib path.
  - Updated lib target to `ESNext`.
  - Replaced VS Code's virtual TypeScript libs URI with file URI.

## Usage

Install globally with npm (or your preferred package manager):

```sh
npm i -g @t1ckbase/vscode-langservers-extracted
```

The following commands are available:

- `vscode-css-language-server`
- `vscode-eslint-language-server`
- `vscode-html-language-server`
- `vscode-json-language-server`
- `vscode-markdown-language-server`

## Third-Party Licenses

- microsoft/vscode: https://github.com/microsoft/vscode/blob/main/LICENSE.txt
- microsoft/vscode-eslint: https://github.com/microsoft/vscode-eslint/blob/main/License.txt
