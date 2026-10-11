#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createOwnerRecovery } from '../server/recovery.js';
const { values } = parseArgs({
  options: { 'data-dir': { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log(
    'Usage: node tools/recover-owner.js [--data-dir /path/to/.omnisync]\nCreates a private, single-use, ten-minute owner recovery key on the service host.',
  );
} else {
  try {
    const result = createOwnerRecovery(
      values['data-dir'] || process.env.OMNI_DATA_DIR || '.omnisync',
    );
    console.log(
      `Recovery key saved privately to ${result.path}.\nOpen that local file and use Recover owner access in the web app within ten minutes.\nSuccessful recovery invalidates all previous owner sessions; shared data and other devices are preserved.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
