#!/usr/bin/env node

import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BuilderCodexUatPrivateAuthorityError,
  admitPriorPreflightReceipt,
  bootstrapPrivateAuthorityRoot,
  loadCodexUatContinuation,
  preflightCodexUatPriorAttempt,
  publishCodexUatContinuation,
  publishPriorPreflightReceipt,
  transitionCodexUatContinuation,
} from "../src/builder-codex-uat-private-authority.js";
import { assertBuilderPlatform } from "../src/builder-platform.js";

const COMMANDS = new Set([
  "run-prior-preflight",
  "admit-prior-preflight-receipt",
  "init-continuation",
  "admit-continuation",
  "transition-continuation",
]);
const MAX_STDIN_BYTES = 64 * 1024;

export async function runPriorPreflight(locator, options = {}) {
  assertPriorPreflightPlatform();
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const preflight = await preflightCodexUatPriorAttempt(locator);
  const authority = await bootstrapPrivateAuthorityRoot({ repositoryRoot, preflight });
  try {
    return await publishPriorPreflightReceipt({ authority, preflight });
  } finally {
    await authority.handle.close().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2), io = {}) {
  assertPriorPreflightPlatform();
  const output = io.output ?? process.stdout;
  const errorOutput = io.errorOutput ?? process.stderr;
  const repositoryRoot = io.repositoryRoot ?? process.cwd();
  const readStdin = io.readStdin ?? (() => readFile(0));
  let command;
  try {
    if (argv.length !== 1 || !COMMANDS.has(argv[0])) fail("AGENTMO_CODEX_UAT_PRIOR_COMMAND_REJECTED");
    command = argv[0];
    rejectLocatorEnvironment();
    let result;
    if (command === "run-prior-preflight") {
      const input = await boundedInput(readStdin);
      result = await runPriorPreflight(input, { repositoryRoot });
    } else if (command === "admit-prior-preflight-receipt") {
      result = await admitPriorPreflightReceipt({ repositoryRoot });
    } else if (command === "init-continuation") {
      const input = parseJson(await boundedInput(readStdin));
      const priorReceiptAdmission = await admitPriorPreflightReceipt({ repositoryRoot });
      result = await publishCodexUatContinuation({ repositoryRoot, priorReceiptAdmission, value: input });
    } else if (command === "admit-continuation") {
      result = await loadCodexUatContinuation({ repositoryRoot });
    } else {
      const input = parseJson(await boundedInput(readStdin));
      if (!exactKeys(input, ["expectedHeadDigest", "next"])) fail("AGENTMO_CODEX_UAT_PRIOR_INPUT_REJECTED");
      const expectedAdmission = await loadCodexUatContinuation({ repositoryRoot });
      if (expectedAdmission.value.headDigest !== input.expectedHeadDigest) {
        fail("AGENTMO_CODEX_UAT_CONTINUATION_STALE");
      }
      result = await transitionCodexUatContinuation({
        repositoryRoot,
        expectedAdmission,
        next: input.next,
      });
    }
    const bounded = command.includes("continuation")
      ? {
          status: "ok",
          schemaVersion: result.schemaVersion,
          digest: result.digest,
          headDigest: result.value.headDigest,
          state: result.value.status,
        }
      : { status: "ok", schemaVersion: result.schemaVersion, digest: result.digest };
    output.write(`${JSON.stringify(bounded)}\n`);
    return 0;
  } catch (error) {
    const code = boundedCode(error);
    errorOutput.write(`${JSON.stringify({ status: "rejected", code })}\n`);
    return 1;
  }
}

async function boundedInput(readStdin) {
  const bytes = await readStdin();
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_STDIN_BYTES) {
    fail("AGENTMO_CODEX_UAT_PRIOR_INPUT_REJECTED");
  }
  return bytes;
}

function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch {
    fail("AGENTMO_CODEX_UAT_PRIOR_INPUT_REJECTED");
  }
}

function rejectLocatorEnvironment() {
  for (const name of ["AGENTMO_CODEX_UAT_LOCATOR", "AGENTMO_CODEX_UAT_PRIOR_LOCATOR"]) {
    if (Object.hasOwn(process.env, name)) fail("AGENTMO_CODEX_UAT_PRIOR_TRANSPORT_REJECTED");
  }
}

function boundedCode(error) {
  if (error instanceof BuilderCodexUatPrivateAuthorityError) return error.code;
  if (typeof error?.code === "string" && /^AGENTMO_[A-Z0-9_]{1,120}$/u.test(error.code)) return error.code;
  return "AGENTMO_CODEX_UAT_PRIVATE_AUTHORITY_REJECTED";
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fail(code) {
  throw new BuilderCodexUatPrivateAuthorityError(code);
}

function assertPriorPreflightPlatform() {
  try {
    assertBuilderPlatform();
  } catch {
    fail("AGENTMO_CODEX_UAT_PRIOR_PLATFORM_UNSUPPORTED");
  }
}

async function isDirectEntry() {
  if (!process.argv[1]) return false;
  try {
    const [entryPath, modulePath] = await Promise.all([
      realpath(path.resolve(process.argv[1])),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    return pathToFileURL(entryPath).href === pathToFileURL(modulePath).href;
  } catch {
    return false;
  }
}

if (await isDirectEntry()) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "rejected", code: boundedCode(error) })}\n`);
    process.exitCode = 1;
  }
}
