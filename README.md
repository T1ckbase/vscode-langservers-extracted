# VSCode Langservers Extracted

[![NPM Version](https://img.shields.io/npm/v/@t1ckbase/vscode-langservers-extracted?logo=npm&color=262626)](https://www.npmjs.com/package/@t1ckbase/vscode-langservers-extracted)
[![Release](https://github.com/T1ckbase/vscode-langservers-extracted/actions/workflows/release.yaml/badge.svg)](https://github.com/T1ckbase/vscode-langservers-extracted/actions/workflows/release.yaml)

A drop-in replacement for [@hrsh7th's `vscode-langservers-extracted`](https://github.com/hrsh7th/vscode-langservers-extracted).

The HTML, CSS, JSON, and Markdown language servers are extracted from [vscode](https://github.com/microsoft/vscode),<br>
while the ESLint language server is extracted from [vscode-eslint](https://github.com/microsoft/vscode-eslint).

## Notes

- The HTML language server is patched to fix the hardcoded TypeScript lib path and update the lib target to ESNext.

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
