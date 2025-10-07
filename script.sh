#!/usr/bin/env bash
set -euo pipefail

# Vibe coded

# --- Helper Functions ---

# Print an error message and exit.
# Usage: die "Something went wrong"
die() {
  echo "[ERROR] $*" >&2
  exit 1
}

# Fetch the latest release tag from a GitHub repository.
# Usage: github_api_get_latest_release_tag "owner/repo"
github_api_get_latest_release_tag() {
  local repo="$1"
  # Fetches the latest release and extracts the tag name.
  # Handles potential API rate limits gracefully by exiting if curl fails.
  curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" | jq -r '.tag_name'
}

# --- Main Logic ---

main() {

  echo "[INFO] Working in current directory: $(pwd)"

  # Define packages to update.
  local packages=("microsoft/vscode" "microsoft/vscode-anycode" "microsoft/vscode-eslint")
  local updates=()

  # Clean up any previous temporary download files
  rm -rf .tmp_download
  mkdir -p .tmp_download
  trap 'rm -rf .tmp_download' EXIT

  for repo in "${packages[@]}"; do
    echo "---"
    echo "[INFO] Checking package: ${repo}"

    # --- 1. Get Latest and Current Versions ---
    local current_version
    current_version=$(jq -r ".metadata.versions[\"${repo}\"]" package.json)

    # Get the latest version tag from the GitHub API.
    local tag_name
    tag_name=$(github_api_get_latest_release_tag "$repo") || die "Failed to fetch latest tag for ${repo}."

    # Extract semantic version (e.g., 1.2.3) from the tag name (e.g., v1.2.3 or release-1.2.3)
    local latest_version
    latest_version=$(echo "$tag_name" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

    if [[ -z "$latest_version" ]]; then
      die "Could not parse a valid version number from tag '${tag_name}' for ${repo}"
    fi

    echo "[UPDATE] Update available for ${repo}: ${current_version} -> ${latest_version}"

    # --- 2. Download and Extract ---
    local download_url
    echo "[INFO] Downloading ${repo} v${latest_version}..."

    # The download URL logic is specific to each package.
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

    # --- 3. Copy Required Files ---
    echo "[INFO] Extracting server files..."
    case "$repo" in
    "microsoft/vscode")
      # Special case: update dependencies from VS Code's extension package.json
      echo "[INFO] Updating dependencies from VS Code source..."
      vscode_deps=$(curl -fsSL "https://raw.githubusercontent.com/microsoft/vscode/${latest_version}/extensions/package.json" | jq '.dependencies')
      jq ".dependencies = \$new_deps" --argjson new_deps "$vscode_deps" package.json >package.json.tmp && mv package.json.tmp package.json

      mkdir -p dist/css dist/html dist/json
      cp -r .tmp_download/tmp/resources/app/extensions/css-language-features/server/dist/node/. dist/css/
      cp -r .tmp_download/tmp/resources/app/extensions/html-language-features/server/dist/node/. dist/html/
      cp -r .tmp_download/tmp/resources/app/extensions/json-language-features/server/dist/node/. dist/json/

      # Prepend shebang to server entry points
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

    # --- 4. Update package.json Version ---
    jq ".metadata.versions[\"${repo}\"] = \"${latest_version}\"" package.json >package.json.tmp
    mv package.json.tmp package.json
    updates+=("${repo} ${current_version} → ${latest_version}")
  done

  # --- Final Steps ---

  if [[ ${#updates[@]} -eq 0 ]]; then
    echo "---"
    echo "[SUCCESS] All packages are already up to date. Nothing to do."
    exit 0
  fi

  echo "---"
  echo "[INFO] Finalizing changes..."

  # Create the commit message by joining the updates array
  commit_message="chore: update vscode language servers:"
  commit_message+=$(IFS=,; echo " ${updates[*]}")

  # Bump version, commit, and publish
  echo "[INFO] Preparing new release..."
  git add package.json
  git commit -m "Update package.json" --force
  npm version patch -m "$commit_message"
 
  echo "[INFO] Publishing to npm..."
  npm publish --provenance --access public

  echo "---"
  echo "[SUCCESS] Done!"
  echo "[INFO] Updated package.json:"
  jq . package.json
}

# Run the main function
main