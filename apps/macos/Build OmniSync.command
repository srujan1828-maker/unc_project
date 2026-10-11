#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
bash build-app.sh --native
open build/OmniSync.app
