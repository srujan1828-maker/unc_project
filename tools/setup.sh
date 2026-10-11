#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e "if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24 for this workspace.');"
npm ci
npm run build
npm test
echo 'Workspace installed and tested. Run npm start, then use the local setup key for first-run enrollment.'
