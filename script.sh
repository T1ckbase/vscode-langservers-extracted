#!/usr/bin/env bash
set -euo pipefail

# --- Helper Functions ---

die() {
  echo "[ERROR] $*" >&2
  exit 1
}

github_api_get_latest_release_tag() {
  local repo="$1"
  curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" | jq -r '.tag_name'
}

# --- Main Logic ---

main() {
  echo "[INFO] Working in current directory: $(pwd)"

  local packages=("microsoft/vscode" "microsoft/vscode-anycode" "microsoft/vscode-eslint")
  local updates=()
  local had_updates=false

  # --- First Pass: Check for updates ---
  echo "[INFO] Checking for updates..."
  for repo in "${packages[@]}"; do
    local current_version
    current_version=$(jq -r ".metadata.versions[\"${repo}\"]" package.json)

    local tag_name
    tag_name=$(github_api_get_latest_release_tag "$repo") || die "Failed to fetch latest tag for ${repo}."

    local latest_version
    latest_version=$(echo "$tag_name" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

    if [[ -z "$latest_version" ]]; then
      die "Could not parse a valid version number from tag '${tag_name}' for ${repo}"
    fi

    if [[ "$current_version" != "$latest_version" ]]; then
      echo "[UPDATE] Update available for ${repo}: ${current_version} -> ${latest_version}"
      had_updates=true
    else
      echo "[INFO] ${repo} is already at latest version (${latest_version})"
    fi
  done

  # --- Exit Early if No Updates ---
  if [[ "$had_updates" == false ]]; then
    echo "---"
    echo "[SUCCESS] All packages are already up to date. Nothing to do."
    exit 0
  fi

  # --- Second Pass: Download ALL packages ---
  echo "---"
  echo "[INFO] Updates found. Downloading ALL packages..."

  # Clean up any previous temporary download files
  rm -rf .tmp_download
  mkdir -p .tmp_download
  trap 'rm -rf .tmp_download' EXIT

  # Remove old dist directory
  rm -rf dist

  for repo in "${packages[@]}"; do
    echo "---"
    echo "[INFO] Processing package: ${repo}"

    local current_version
    current_version=$(jq -r ".metadata.versions[\"${repo}\"]" package.json)

    local tag_name
    tag_name=$(github_api_get_latest_release_tag "$repo") || die "Failed to fetch latest tag for ${repo}."

    local latest_version
    latest_version=$(echo "$tag_name" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

    # --- Download and Extract ---
    local download_url
    echo "[INFO] Downloading ${repo} v${latest_version}..."

    case "$repo" in
    "microsoft/vscode")
      download_url="https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-archive"
      ;;
    "microsoft/vscode-anycode")
      download_url="https://ms-vscode.gallery.vsassets.io/_apis/public/gallery/publisher/ms-vscode/extension/anycode/${latest_version}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage"
      ;;
    "microsoft/vscode-eslint")
      download_url="https://dbaeumer.gallery.vsassets.io/_apis/public/gallery/publisher/dbaeumer/extension/vscode-eslint/${latest_version}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage"
      ;;
    *)
      die "Unknown package repository: $repo"
      ;;
    esac

    curl -fsSL "$download_url" -o ".tmp_download/tmp.zip"
    unzip -q ".tmp_download/tmp.zip" -d ".tmp_download/tmp"
    rm ".tmp_download/tmp.zip"

    # --- Copy Required Files ---
    echo "[INFO] Extracting server files..."
    case "$repo" in
    "microsoft/vscode")
      echo "[INFO] Updating dependencies from VS Code source..."
      vscode_deps=$(curl -fsSL "https://raw.githubusercontent.com/microsoft/vscode/${latest_version}/extensions/package.json" | jq '.dependencies')
      jq ".dependencies = \$new_deps" --argjson new_deps "$vscode_deps" package.json >package.json.tmp && mv package.json.tmp package.json

      mkdir -p dist/css dist/html dist/json
      cp -r .tmp_download/tmp/resources/app/extensions/css-language-features/server/dist/node/. dist/css/
      cp -r .tmp_download/tmp/resources/app/extensions/html-language-features/server/dist/node/. dist/html/
      cp -r .tmp_download/tmp/resources/app/extensions/json-language-features/server/dist/node/. dist/json/

      sed -i '1i #!/usr/bin/env node' dist/css/cssServerMain.js
      sed -i '1i #!/usr/bin/env node' dist/html/htmlServerMain.js
      sed -i '1i #!/usr/bin/env node' dist/json/jsonServerMain.js
      ;;
    "microsoft/vscode-anycode")
      mkdir -p dist/anycode
      cp .tmp_download/tmp/extension/dist/anycode.server.node.js dist/anycode/
      sed -i '1i #!/usr/bin/env node' dist/anycode/anycode.server.node.js
      ;;
    "microsoft/vscode-eslint")
      mkdir -p dist/eslint
      cp -r .tmp_download/tmp/extension/server/out/. dist/eslint/
      sed -i '1i #!/usr/bin/env node' dist/eslint/eslintServer.js
      ;;
    esac

    rm -rf ".tmp_download/tmp"

    # --- Update package.json Version ---
    jq ".metadata.versions[\"${repo}\"] = \"${latest_version}\"" package.json >package.json.tmp
    mv package.json.tmp package.json
    
    if [[ "$current_version" != "$latest_version" ]]; then
      updates+=("${repo} ${current_version} → ${latest_version}")
    fi
  done

  # --- Exit based on whether there were version updates ---
  if [[ "$had_updates" == false ]]; then
    echo "---"
    echo "[SUCCESS] All packages are already up to date. Nothing to do."
    exit 0
  fi

  echo "---"
  echo "[SUCCESS] Updated ${#updates[@]} package(s)"
  echo "[INFO] Changes ready for commit and publish"
}

main