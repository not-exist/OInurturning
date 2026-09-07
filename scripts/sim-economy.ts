import { run } from '../apps/api/src/scripts/sim-economy.js';

run(process.argv.slice(2)).then((status) => {
  process.exitCode = status;
});
