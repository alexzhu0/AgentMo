#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startCourseWikiServer } from "../src/course-wiki-server.js";
import { COURSE_WIKI_INTERACTIVE_CAMPAIGN, provisionCourseAgentWorkspace, runCourseWorkspaceTurn } from "../src/course-wiki-openclaw.js";
import { startCourseGateway } from "../src/course-wiki-gateway.js";

const LIVE_ROOT = "/Users/alexzhu/Lenovo/AgentMo/.worktrees/course-wiki/.agentmo/course-wiki-interactive-2026-09-15-r2";
const DEFAULT_PORT = 17892;

export function resolveCourseWikiLaunch(argv) {
  let live = false;
  let projectRoot;
  let root;
  let action, message, portSpecified = false;
  let port = DEFAULT_PORT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (argument === "--live") {
      live = true;
    } else if (argument === "--project") {
      if (projectRoot !== undefined) fail();
      projectRoot = argv[++index];
      if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)
        || path.normalize(projectRoot) !== projectRoot || projectRoot === "/") fail();
    } else if (argument === "--prepare-workspace" || argument === "--ask" || argument === "--gateway") {
      if (action) fail();
      action = argument.slice(2);
      if (action === "ask") { message = argv[++index]; if (!message?.trim() || message.length > 2000) fail(); }
    } else if (argument === "--root") {
      root = argv[++index];
      if (!root) fail();
    } else if (argument === "--port") {
      portSpecified = true;
      port = Number(argv[++index]);
      if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) fail();
    } else {
      fail();
    }
  }
  if (projectRoot !== undefined && (live || root !== undefined || (action && action !== "gateway"))) fail();
  if (live && root !== undefined) fail();
  if (action && !live && projectRoot === undefined) fail();
  if (action === "gateway" && portSpecified) fail();
  if (!live && projectRoot === undefined && (typeof root !== "string" || !path.isAbsolute(root) || path.normalize(root) !== root)) fail();
  root = projectRoot ?? (live ? LIVE_ROOT : root);
  return {
    root,
    port: action === "gateway" ? 17893 : port,
    ...(action ? { action, ...(message !== undefined ? { message } : {}) } : {}),
    liveAuthorization: live || projectRoot !== undefined ? Object.freeze({
      authorized: true,
      campaign: projectRoot !== undefined ? "course-wiki-selected-documents-v1" : COURSE_WIKI_INTERACTIVE_CAMPAIGN,
      root,
    }) : null,
  };
}

async function main() {
  const launch = resolveCourseWikiLaunch(process.argv.slice(2));
  if (launch.help) {
    process.stdout.write("Usage: node scripts/course-wiki-poc.mjs (--live | --root /absolute/existing/root | --project /absolute/bound/runtime) [--port 17892]\nNative workspace: --live --prepare-workspace | --live --ask <question> | (--live | --project /absolute/bound/runtime) --gateway\nProject mode requires an existing shared-budget binding and exact per-corpus confirmation; it never creates or resets a budget.\n");
    return;
  }
  if (launch.action && launch.action !== "gateway") {
    const result = launch.action === "prepare-workspace" ? await provisionCourseAgentWorkspace(launch) : await runCourseWorkspaceTurn(launch);
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  const app = launch.action === "gateway" ? await startCourseGateway({...launch,apiKey:process.env.DEEPSEEK_API_KEY,onEvent:event=>process.stdout.write(JSON.stringify(event)+"\n")}) : await startCourseWikiServer({...launch,apiKey:process.env.DEEPSEEK_API_KEY});
  process.stdout.write(launch.action === "gateway" ? `Course Wiki model channel ready at ${app.url}; chat through OpenClaw.\n` : `Course Wiki is running at ${app.url}\nPress Ctrl-C to stop.\n`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

function fail() {
  throw Object.assign(new Error("Course Wiki launcher arguments were rejected."), {
    code: "COURSE_WIKI_LAUNCH_INVALID",
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    const code = typeof error?.code === "string" && /^COURSE_WIKI_[A-Z0-9_]+$/u.test(error.code)
      ? error.code : "COURSE_WIKI_LAUNCH_FAILED";
    process.stderr.write(`Course Wiki could not start (${code}).\n`);
    process.exitCode = 1;
  });
}
