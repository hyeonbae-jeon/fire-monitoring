#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools_dir="${CCTV_TOOLS_DIR:-/workspace/.tools}"
export DOTNET_ROOT="$tools_dir/dotnet"
export DOTNET_CLI_HOME="$tools_dir/dotnet-home"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
export PATH="$DOTNET_ROOT:$PATH"
mkdir -p "$tools_dir"
if [[ ! -x "$DOTNET_ROOT/dotnet" ]] || [[ "$("$DOTNET_ROOT/dotnet" --version)" != '8.0.425' ]]; then
  [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
    echo 'This cloud installer requires Linux x64; install .NET 8.0.425 for other platforms.' >&2
    exit 1
  }
  sdk_archive="$(mktemp "$tools_dir/dotnet-sdk.XXXXXX.tar.gz")"
  trap 'rm -f "$sdk_archive"' EXIT
  curl -fLsS --retry 2 --max-time 180 \
    https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.425/dotnet-sdk-8.0.425-linux-x64.tar.gz \
    -o "$sdk_archive"
  # SHA512 from Microsoft's HTTPS .NET 8 release metadata.
  printf '%s  %s\n' \
    '934b8060a7190e5909ad1fd0785db542f487b3bbf6cdd14826b02095fdd0d0394298b1634085eff302928fccc33f7c1a7253e9b87df555fc36fce819bcd2e798' \
    "$sdk_archive" | sha512sum --check --status
  mkdir -p "$DOTNET_ROOT"
  tar -xzf "$sdk_archive" -C "$DOTNET_ROOT"
fi
cd "$repo_dir/web"
npm ci --cache "$tools_dir/npm-cache" --no-audit --no-fund
npm run build -- --outDir ../bridge/WisenetPtzBridge/wwwroot --emptyOutDir
cd "$repo_dir"
dotnet build bridge/WisenetPtzBridge -c Release --nologo
DOTNET_EXECUTABLE="$DOTNET_ROOT/dotnet" python3 tests/test_inventory.py
if command -v chromium >/dev/null 2>&1; then
  cd "$repo_dir/web"
  DOTNET_EXECUTABLE="$DOTNET_ROOT/dotnet" CHROMIUM_EXECUTABLE="$(command -v chromium)" npm run test:e2e
fi
