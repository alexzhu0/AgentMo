#!/usr/bin/env node
import { main } from "../src/cli.js";
import { redactManagedText } from "../src/secret-redaction.js";

main(process.argv.slice(2)).catch((error) => {
  console.error(redactManagedText(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
