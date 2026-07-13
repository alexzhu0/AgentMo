#!/usr/bin/env node
import { main } from "../src/cli.js";

main(process.argv.slice(2)).catch(() => {
  process.exitCode = 1;
});
