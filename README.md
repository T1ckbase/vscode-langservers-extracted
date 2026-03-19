# VSCode Langservers Extracted

[![NPM Version](https://img.shields.io/npm/v/@t1ckbase/vscode-langservers-extracted?logo=npm&color=262626)](https://www.npmjs.com/package/@t1ckbase/vscode-langservers-extracted)
[![Extract and Publish to npm](https://github.com/T1ckbase/vscode-langservers-extracted/actions/workflows/extract-and-publish.yaml/badge.svg)](https://github.com/T1ckbase/vscode-langservers-extracted/actions/workflows/extract-and-publish.yaml)

HTML/CSS/JSON language servers extracted from [vscode](https://github.com/microsoft/vscode),
and the ESLint language server from [vscode-eslint](https://github.com/microsoft/vscode-eslint).

This project exists because the original repository by [@hrsh7th](https://github.com/hrsh7th/vscode-langservers-extracted) is no longer actively updated, so I created this for my own use and keep it updated.

A GitHub Actions workflow runs weekly to check for upstream updates, rebuild the package, run smoke tests, and publish new versions automatically.

## Notes

- New versions are published automatically after only simple smoke testing, so breakages are possible. Please pin a specific version instead of relying on the latest release.
- The official Markdown language server is already available on npm and is not included in this package:  
  https://www.npmjs.com/package/vscode-markdown-languageserver

## Usage

Install globally with npm (or your preferred package manager):

```sh
npm i -g @t1ckbase/vscode-langservers-extracted
```

The following commands are available:

- `vscode-css-language-server`
- `vscode-html-language-server`
- `vscode-json-language-server`
- `vscode-eslint-language-server`

## Third-Party Licenses

- microsoft/vscode: https://github.com/microsoft/vscode/blob/main/LICENSE.txt
- microsoft/vscode-eslint: https://github.com/microsoft/vscode-eslint/blob/main/License.txt
