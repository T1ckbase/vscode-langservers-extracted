#!/bin/bash

set -euo pipefail

cd /tmp

vscode_version=$(curl -fsSL -o vscode.zip -w '%{url_effective}' "https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-archive" | grep -oP '(\d+\.\d+\.\d+)(?=\.zip)')
echo $vscode_version