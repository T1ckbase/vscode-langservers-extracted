# VSCode Langservers Extracted

[![NPM Version](https://img.shields.io/npm/v/@t1ckbase/vscode-langservers-extracted?logo=npm&color=262626)](https://www.npmjs.com/package/@t1ckbase/vscode-langservers-extracted)
[![Release](https://github.com/T1ckbase/vscode-langservers-extracted/actions/workflows/release.yaml/badge.svg)](https://github.com/T1ckbase/vscode-langservers-extracted/actions/workflows/release.yaml)

A drop-in replacement for [@hrsh7th's `vscode-langservers-extracted`](https://github.com/hrsh7th/vscode-langservers-extracted), with special thanks for creating the original project.

The HTML, CSS, and JSON language servers are extracted from [VS Code](https://github.com/microsoft/vscode), while the ESLint language server is extracted from the [VS Code ESLint extension](https://github.com/microsoft/vscode-eslint). Markdown language server uses the official [`vscode-markdown-languageserver`](https://www.npmjs.com/package/vscode-markdown-languageserver) package.

`vscode-markdown-language-server` relies on the client to parse Markdown (`markdown/parse`), which most LSP clients do not implement. Using a dedicated alternative like [Marksman](https://github.com/artempyanykh/marksman) is recommended.

Note that [`@zed-industries/vscode-langservers-extracted`](https://github.com/zed-industries/vscode-langservers-extracted) is tailored specifically for Zed and currently only includes the HTML language server.

## Patches

- HTML language server:
  - Fixed embedded JavaScript IntelliSense by replacing hardcoded TypeScript `lib` path with runtime resolution.
  - Fixed Go to Definition by replacing VS Code's virtual TypeScript libs URI with `file` URI.
  - Fixed crash on missing `js/ts.implicitProjectConfig` in generic clients.
  - Fixed crash on `null` CSS lint settings from `workspace/configuration`. (microsoft/vscode-html-languageservice#227, neovim/nvim-lspconfig#3393, zed-industries/zed#44874)
  - Updated `lib` target to `ESNext`.
- CSS language server:
  - Fixed crash on `null` CSS lint settings from `workspace/configuration`. (microsoft/vscode-html-languageservice#227, neovim/nvim-lspconfig#3393, zed-industries/zed#44874)

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
