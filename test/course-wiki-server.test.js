import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { runInNewContext } from "node:vm";

import { startCourseWikiServer } from "../src/course-wiki-server.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const GENERATION_A = "11111111-1111-4111-8111-111111111111";
const GENERATION_B = "22222222-2222-4222-8222-222222222222";
const NATIVE_CHAT_URL = "http://127.0.0.1:18789/chat/course-wiki";
const cleanups = [];

afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

test("binds to IPv4 loopback and rejects hostile Host and Origin before operations", async () => {
  let stages = 0;
  const { app } = await fixture({ stageCourseCorpus: async () => { stages += 1; } });
  assert.equal(app.server.address().address, "127.0.0.1");
  assert.equal((await rawRequest(app, { headers: { Host: "evil.example" } })).statusCode, 403);
  const foreign = await fetch(app.url + "/api/documents", {
    method: "POST",
    headers: { Origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ documents: [{ name: "notes.txt", base64: "bm90ZXM=" }] }),
  });
  assert.equal(foreign.status, 403);
  assert.equal(stages, 0);
});

test("upload normalizes the whole batch and stages locally without activation", async () => {
  const calls = [];
  const preview = stageResult();
  const { app } = await fixture({
    normalizeDocument: async ({ name, bytes }) => {
      calls.push(["normalize", name, bytes.toString("utf8")]);
      return { name, sourceDigest: DIGEST_A, text: "lesson", lines: ["lesson"], originalBytes: bytes };
    },
    stageCourseCorpus: async (input) => { calls.push(["stage", input]); return preview; },
    activateCourseCorpus: async () => { calls.push(["activate"]); },
  });
  const response = await postJson(app, "/api/documents", {
    documents: [{ name: "lesson.txt", base64: Buffer.from("lesson").toString("base64") }],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), preview);
  assert.deepEqual(calls[0], ["normalize", "lesson.txt", "lesson"]);
  assert.equal(calls[1][0], "stage");
  assert.equal(calls[1][1].root, app.root);
  assert.equal(calls.some(([kind]) => kind === "activate"), false);
});

test("upload enforces file count, aggregate characters, and declared body bounds", async () => {
  let stages = 0;
  const { app } = await fixture({
    normalizeDocument: async ({ name, bytes }) => ({ name, sourceDigest: DIGEST_A, text: bytes.toString("utf8"), lines: ["x"], originalBytes: bytes }),
    stageCourseCorpus: async () => { stages += 1; return stageResult(); },
  });
  assert.equal((await postJson(app, "/api/documents", { documents: [] })).status, 400);
  assert.equal((await postJson(app, "/api/documents", {
    documents: Array.from({ length: 11 }, (_, index) => ({ name: `${index}.txt`, base64: "eA==" })),
  })).status, 400);
  assert.equal((await postJson(app, "/api/documents", {
    documents: [{ name: "large.txt", base64: Buffer.from("x".repeat(100_001)).toString("base64") }],
  })).status, 413);
  assert.equal((await postJson(app, "/api/documents", {
    documents: [{ name: "bytes.txt", base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") }],
  })).status, 413);
  assert.equal((await rawRequest(app, {
    method: "POST",
    path: "/api/documents",
    headers: { Origin: app.url, "content-type": "application/json", "content-length": String(50 * 1024 * 1024) },
  })).statusCode, 413);
  assert.equal(stages, 0);
});

test("activation accepts only the URL generation and exact consent", async () => {
  const received = [];
  let liveAuthorization;
  const { app } = await fixture(
    { activateCourseCorpus: async (input) => { received.push(input); return activeResult(); } },
    {
      liveAuthorization: (root) => {
        liveAuthorization = Object.freeze({ authorized: true, campaign: "course-wiki-selected-documents-v1", root });
        return liveAuthorization;
      },
      apiKey: "server-held-key",
    },
  );
  const consent = exactConsent(DIGEST_A);
  for (const body of [
    { ...consent, confirmed: false },
    { ...consent, root: "/attacker" },
    { consent },
  ]) {
    assert.equal((await postJson(app, `/api/generations/${GENERATION_A}/activate`, body)).status, 403);
  }
  const accepted = await postJson(app, `/api/generations/${GENERATION_A}/activate`, consent);
  assert.equal(accepted.status, 200);
  assert.deepEqual(received, [{
    root: app.root,
    generationId: GENERATION_A,
    consent,
    liveAuthorization,
    apiKey: "server-held-key",
  }]);
});

test("bad request is 400, invalid consent 403, busy 409, and all are non-retryable", async () => {
  for (const [code, status] of [
    ["COURSE_WIKI_REQUEST_INVALID", 400],
    ["COURSE_WIKI_CONSENT_INVALID", 403],
    ["COURSE_WIKI_CONSENT_REJECTED", 403],
    ["COURSE_WIKI_OPERATION_BUSY", 409],
  ]) {
    const { app } = await fixture({
      activateCourseCorpus: async () => { throw Object.assign(new Error("private detail"), { code }); },
    });
    const response = await postJson(app, `/api/generations/${GENERATION_A}/activate`, exactConsent(DIGEST_A));
    const body = await response.json();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-should-retry"), "false");
    assert.equal(JSON.stringify(body).includes("private detail"), false);
  }
});

test("evidence context refusal is a sanitized non-retryable 400 while upload size stays 413", async () => {
  for (const [code, status] of [["COURSE_WIKI_EVIDENCE_TOO_LARGE", 400], ["COURSE_WIKI_DOCUMENT_TOO_LARGE", 413]]) {
    const { app } = await fixture({
      activateCourseCorpus: async () => { throw Object.assign(new Error("PRIVATE CONTEXT CANARY"), { code }); },
    });
    const response = await postJson(app, `/api/generations/${GENERATION_A}/activate`, exactConsent(DIGEST_A));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-should-retry"), "false");
    assert.deepEqual(await response.json(), { error: { code } });
  }
});

test("reads propagate an optional exact generation and reject malformed query state", async () => {
  const calls = [];
  const { app } = await fixture({
    getCourseDocument: async (input) => { calls.push(input); return {}; },
    getCourseTopic: async (input) => { calls.push(input); return {}; },
  });
  assert.equal((await fetch(app.url + `/api/documents/${encodeURIComponent(DIGEST_A)}?generationId=${GENERATION_A}`)).status, 200);
  assert.equal((await fetch(app.url + "/api/topics/topic-1")).status, 200);
  assert.equal((await fetch(app.url + "/api/topics/topic-1?generationId=wrong")).status, 400);
  assert.equal((await fetch(app.url + `/api/topics/topic-1?generationId=${GENERATION_A}&extra=1`)).status, 400);
  assert.deepEqual(calls, [
    { root: app.root, generationId: GENERATION_A, sourceDigest: DIGEST_A },
    { root: app.root, id: "topic-1" },
  ]);
});

test("server has corpus and browsing surfaces but no second chat or old generation route", async () => {
  const { app } = await fixture();
  const corpus = await fetch(app.url + "/api/corpus");
  assert.equal(corpus.status, 200);
  assert.equal(corpus.headers.get("x-should-retry"), "false");
  assert.equal((await postJson(app, "/api/wiki", {})).status, 404);
  assert.equal((await postJson(app, "/api/questions", { message: "hello" })).status, 404);
});

test("selected-document authority permits staging while a legacy live campaign keeps uploads closed", async () => {
  let normalizations = 0;
  const operationOverrides = { normalizeDocument: async () => { normalizations += 1; return {}; } };
  const { app: selected } = await fixture(operationOverrides, {
    liveAuthorization: (root) => ({ authorized: true, campaign: "course-wiki-selected-documents-v1", root }),
  });
  const { app: legacy } = await fixture(operationOverrides, {
    liveAuthorization: (root) => ({ authorized: true, campaign: "course-wiki-interactive-2026-09-15", root }),
  });
  const document = { documents: [{ name: "notes.txt", base64: "bm90ZXM=" }] };

  assert.equal((await postJson(selected, "/api/documents", document)).status, 200);
  assert.equal((await postJson(legacy, "/api/documents", document)).status, 403);
  assert.equal((await (await fetch(legacy.url + "/api/corpus")).json()).access.uploads, false);
  assert.equal(normalizations, 1);
});

test("UI stages an exact preview and dispatches consent only on confirmation", async () => {
  const requests = [];
  const ui = await startUi(async (url, options = {}) => {
    requests.push([url, options]);
    if (url === "/api/corpus") return jsonResponse(corpusResult());
    if (url === "/api/documents") return jsonResponse(stageResult());
    if (url === `/api/generations/${GENERATION_A}/activate`) return jsonResponse(activeResult());
    throw new Error(`unexpected request: ${url}`);
  });
  await ui.elements["file-input"].dispatch("change", { target: { files: [uploadFile("lesson.txt", "lesson")] } });
  assert.match(ui.elements["preview-status"].textContent, /preview/u);
  assert.match(ui.elements["preview-summary"].textContent, /6/u);
  assert.match(ui.elements["preview-summary"].textContent, /DeepSeek/u);
  assert.match(ui.elements["preview-summary"].textContent, /wiki-and-qa/u);
  assert.match(ui.elements["preview-list"].children[0].children[0].textContent, /sha256:a{64}/u);
  assert.equal(requests.filter(([url]) => url.includes("/activate")).length, 0);
  await ui.elements["confirm-button"].dispatch("click");
  const activation = requests.find(([url]) => url.includes("/activate"));
  assert.equal(activation[0], `/api/generations/${GENERATION_A}/activate`);
  assert.deepEqual(JSON.parse(activation[1].body), exactConsent(DIGEST_A));
  assert.match(ui.elements["upload-status"].textContent, /已确认.*已发布/u);
  assert.doesNotMatch(ui.elements["upload-status"].textContent, /尚未授权/u);
});

test("ready duplicate needs confirmation while active duplicate spends nothing", async () => {
  let uploads = 0;
  let activations = 0;
  const ui = await startUi(async (url) => {
    if (url === "/api/corpus") return jsonResponse(corpusResult());
    if (url === "/api/documents") {
      uploads += 1;
      return jsonResponse(stageResult(uploads === 1
        ? { status: "ready", duplicate: true }
        : { status: "active", duplicate: true }));
    }
    if (url.includes("/activate")) activations += 1;
    return jsonResponse(activeResult());
  });
  await ui.elements["file-input"].dispatch("change", { target: { files: [uploadFile("a.txt", "a")] } });
  assert.equal(ui.elements["confirm-button"].disabled, false);
  await ui.elements["file-input"].dispatch("change", { target: { files: [uploadFile("a2.txt", "a")] } });
  assert.equal(ui.elements["confirm-button"].disabled, true);
  await ui.elements["confirm-button"].dispatch("click");
  assert.equal(activations, 0);
  assert.match(ui.elements["preview-status"].textContent, /active/u);
});

test("failed activation keeps old active Wiki and does not auto-retry", async () => {
  let activations = 0;
  const ui = await startUi(async (url) => {
    if (url === "/api/corpus") return jsonResponse(corpusResult({ active: activeResult() }));
    if (url === `/api/topics/topic-1?generationId=${GENERATION_A}`) {
      return jsonResponse({ id: "topic-1", title: "Old", body: "old active Wiki", citations: [] });
    }
    if (url === "/api/documents") return jsonResponse(stageResult({ generationId: GENERATION_B, corpusDigest: DIGEST_B }));
    if (url === `/api/generations/${GENERATION_B}/activate`) {
      activations += 1;
      return jsonResponse({ error: { code: "COURSE_WIKI_UPSTREAM_TIMEOUT" } }, 502);
    }
    throw new Error(`unexpected request: ${url}`);
  }, (candidate) => candidate.elements["topic-body"].textContent === "old active Wiki");
  await ui.elements["file-input"].dispatch("change", { target: { files: [uploadFile("new.txt", "new")] } });
  await ui.elements["confirm-button"].dispatch("click");
  assert.equal(activations, 1);
  assert.equal(ui.elements["topic-body"].textContent, "old active Wiki");
  assert.match(ui.elements["preview-status"].textContent, /failed/u);
});

test("failed paid activation refreshes reserved allowance without retrying or replacing the old Wiki", async () => {
  let corpusReads = 0;
  let activations = 0;
  const ui = await startUi(async (url) => {
    if (url === "/api/corpus") {
      corpusReads += 1;
      return jsonResponse(corpusResult({
        active: activeResult(),
        budget: corpusReads === 1
          ? { reservedCny: 1, capCny: 100, remainingFen: 9900 }
          : { reservedCny: 2, capCny: 100, remainingFen: 9800 },
      }));
    }
    if (url === `/api/topics/topic-1?generationId=${GENERATION_A}`) {
      return jsonResponse({ id: "topic-1", title: "Old", body: "old active Wiki", citations: [] });
    }
    if (url === "/api/documents") return jsonResponse(stageResult({ generationId: GENERATION_B, corpusDigest: DIGEST_B }));
    if (url === `/api/generations/${GENERATION_B}/activate`) {
      activations += 1;
      return jsonResponse({ error: { code: "COURSE_WIKI_UPSTREAM_TIMEOUT" } }, 502);
    }
    throw new Error(`unexpected request: ${url}`);
  }, (candidate) => candidate.elements["topic-body"].textContent === "old active Wiki");

  await ui.elements["file-input"].dispatch("change", { target: { files: [uploadFile("new.txt", "new")] } });
  await ui.elements["confirm-button"].dispatch("click");

  assert.equal(activations, 1);
  assert.equal(corpusReads, 2);
  assert.match(ui.elements["budget-status"].textContent, /已预留 2 CNY/u);
  assert.match(ui.elements["budget-status"].textContent, /剩余可预留 98 CNY/u);
  assert.match(ui.elements["preview-status"].textContent, /failed/u);
  assert.equal(ui.elements["topic-body"].textContent, "old active Wiki");
});

test("failed allowance refresh marks the budget unavailable without erasing failure or the old Wiki", async () => {
  let corpusReads = 0;
  let activations = 0;
  const ui = await startUi(async (url) => {
    if (url === "/api/corpus") {
      corpusReads += 1;
      return corpusReads === 1
        ? jsonResponse(corpusResult({ active: activeResult(), budget: { reservedCny: 1, capCny: 100, remainingFen: 9900 } }))
        : jsonResponse({ error: { code: "COURSE_WIKI_SERVER_FAILURE" } }, 500);
    }
    if (url === `/api/topics/topic-1?generationId=${GENERATION_A}`) {
      return jsonResponse({ id: "topic-1", title: "Old", body: "old active Wiki", citations: [] });
    }
    if (url === "/api/documents") return jsonResponse(stageResult({ generationId: GENERATION_B, corpusDigest: DIGEST_B }));
    if (url === `/api/generations/${GENERATION_B}/activate`) {
      activations += 1;
      return jsonResponse({ error: { code: "COURSE_WIKI_UPSTREAM_TIMEOUT" } }, 502);
    }
    throw new Error(`unexpected request: ${url}`);
  }, (candidate) => candidate.elements["topic-body"].textContent === "old active Wiki");

  await ui.elements["file-input"].dispatch("change", { target: { files: [uploadFile("new.txt", "new")] } });
  await ui.elements["confirm-button"].dispatch("click");

  assert.equal(activations, 1);
  assert.equal(corpusReads, 2);
  assert.match(ui.elements["budget-status"].textContent, /暂时不可用/u);
  assert.equal(ui.elements["budget-status"].textContent.includes("已预留 1 CNY"), false);
  assert.match(ui.elements["preview-status"].textContent, /failed/u);
  assert.equal(ui.elements["topic-body"].textContent, "old active Wiki");
});

test("consent rejection keeps the preview failed with a bounded explanation", async () => {
  let corpusReads = 0;
  let activations = 0;
  const ui = await startUi(async (url) => {
    if (url === "/api/corpus") { corpusReads += 1; return jsonResponse(corpusResult()); }
    if (url === "/api/documents") return jsonResponse(stageResult());
    if (url === `/api/generations/${GENERATION_A}/activate`) {
      activations += 1;
      return jsonResponse({ error: { code: "COURSE_WIKI_CONSENT_REJECTED" } }, 403);
    }
    throw new Error(`unexpected request: ${url}`);
  });

  await ui.elements["file-input"].dispatch("change", { target: { files: [uploadFile("new.txt", "new")] } });
  await ui.elements["confirm-button"].dispatch("click");

  assert.equal(activations, 1);
  assert.equal(corpusReads, 2);
  assert.match(ui.elements["preview-status"].textContent, /确认内容与当前预览不一致/u);
  assert.equal(ui.elements["preview-status"].textContent.includes("COURSE_WIKI_CONSENT_REJECTED"), false);
});

test("evidence context refusal explains model bounds without retrying or replacing the old Wiki", async () => {
  let activations = 0;
  let corpusReads = 0;
  const ui = await startUi(async (url) => {
    if (url === "/api/corpus") { corpusReads += 1; return jsonResponse(corpusResult({ active: activeResult() })); }
    if (url === `/api/topics/topic-1?generationId=${GENERATION_A}`) {
      return jsonResponse({ id: "topic-1", title: "Old", body: "old active Wiki", citations: [] });
    }
    if (url === "/api/documents") return jsonResponse(stageResult({ generationId: GENERATION_B }));
    if (url === `/api/generations/${GENERATION_B}/activate`) {
      activations += 1;
      return jsonResponse({ error: { code: "COURSE_WIKI_EVIDENCE_TOO_LARGE", message: "PRIVATE CONTEXT CANARY" } }, 400);
    }
    throw new Error(`unexpected request: ${url}`);
  }, (candidate) => candidate.elements["topic-body"].textContent === "old active Wiki");
  await ui.elements["file-input"].dispatch("change", { target: { files: [uploadFile("new.txt", "new")] } });
  await ui.elements["confirm-button"].dispatch("click");
  assert.equal(activations, 1);
  assert.equal(corpusReads, 2);
  const message = ui.elements["preview-status"].textContent;
  assert.match(message, /模型上下文/u);
  assert.match(message, /不会截断/u);
  assert.match(message, /不会自动重试/u);
  assert.equal(message.includes("COURSE_WIKI_EVIDENCE_TOO_LARGE"), false);
  assert.equal(message.includes("PRIVATE CONTEXT CANARY"), false);
  assert.equal(ui.elements["topic-body"].textContent, "old active Wiki");
});

test("selecting another topic immediately clears old citations and source content", async () => {
  const oldSource = deferred();
  const nextTopic = deferred();
  const ui = await startUi(async (url) => {
    if (url === "/api/corpus") return jsonResponse(corpusResult({ active: activeResult({ topics: [{ id: "topic-1", title: "Old" }, { id: "topic-2", title: "New" }] }) }));
    if (url === `/api/topics/topic-1?generationId=${GENERATION_A}`) {
      return jsonResponse({ id: "topic-1", title: "Old", body: "old topic", citations: [{ sourceDigest: DIGEST_A, fromLine: 1, toLine: 1, quote: "old quote" }] });
    }
    if (url === `/api/topics/topic-2?generationId=${GENERATION_A}`) return nextTopic.promise;
    if (url === `/api/documents/${encodeURIComponent(DIGEST_A)}?generationId=${GENERATION_A}`) return oldSource.promise;
    throw new Error(`unexpected request: ${url}`);
  }, (candidate) => candidate.elements["wiki-citations"].children.length === 1);

  const oldRead = ui.elements["wiki-citations"].children[0].dispatch("click");
  const selecting = ui.elements["topic-tabs"].children[1].dispatch("click");
  await Promise.resolve();

  assert.equal(ui.elements["wiki-citations"].children.length, 0);
  assert.equal(ui.elements["source-view"].children.length, 0);
  assert.equal(ui.elements["source-view"].textContent, "");

  oldSource.resolve(jsonResponse({ name: "old.txt", originalText: "old", provenanceText: "old", licenseText: "old" }));
  await oldRead;
  assert.equal(ui.elements["source-view"].children.length, 0);
  nextTopic.resolve(jsonResponse({ id: "topic-2", title: "New", body: "new topic", citations: [] }));
  await selecting;
  assert.equal(ui.elements["topic-body"].textContent, "new topic");
  assert.equal(ui.elements["source-view"].children.length, 0);
});

test("topic and source reads stay pinned to the generation that rendered them", async () => {
  const urls = [];
  const ui = await startUi(async (url) => {
    urls.push(url);
    if (url === "/api/corpus") return jsonResponse(corpusResult({ active: activeResult() }));
    if (url === `/api/topics/topic-1?generationId=${GENERATION_A}`) {
      return jsonResponse({ id: "topic-1", title: "Old", body: "old", citations: [{ sourceDigest: DIGEST_A, fromLine: 1, toLine: 1, quote: "quote" }] });
    }
    if (url === `/api/documents/${encodeURIComponent(DIGEST_A)}?generationId=${GENERATION_A}`) {
      return jsonResponse({ name: "lesson.txt", originalText: "original", provenanceText: "source", licenseText: "license" });
    }
    throw new Error(`unexpected request: ${url}`);
  }, (candidate) => candidate.elements["wiki-citations"].children.length === 1);
  await ui.elements["wiki-citations"].children[0].dispatch("click");
  assert.ok(urls.includes(`/api/topics/topic-1?generationId=${GENERATION_A}`));
  assert.ok(urls.includes(`/api/documents/${encodeURIComponent(DIGEST_A)}?generationId=${GENERATION_A}`));
});

test("legacy flat corpus remains browsable and read-only without inventing a generation", async () => {
  const urls = [];
  const ui = await startUi(async (url) => {
    urls.push(url);
    if (url === "/api/corpus") return jsonResponse({
      sources: [{ name: "legacy.txt", sourceDigest: DIGEST_A }],
      topics: [{ id: "topic-1", title: "Legacy" }],
      access: { uploads: false, nativeChatUrl: NATIVE_CHAT_URL },
    });
    if (url === "/api/topics/topic-1") return jsonResponse({
      id: "topic-1", body: "retained legacy Wiki", citations: [{ sourceDigest: DIGEST_A, fromLine: 1, toLine: 1, quote: "retained quote" }],
    });
    if (url === `/api/documents/${encodeURIComponent(DIGEST_A)}`) return jsonResponse({ name: "legacy.txt", originalText: "retained original" });
    throw new Error(`unexpected legacy request: ${url}`);
  });
  assert.equal(ui.elements["document-list"].children.length, 1);
  assert.equal(ui.elements["topic-tabs"].children.length, 1);
  await waitFor(() => ui.elements["topic-body"].textContent === "retained legacy Wiki");
  assert.equal(ui.elements["topic-body"].textContent, "retained legacy Wiki");
  assert.match(ui.elements["wiki-status"].textContent, /旧版.*只读/u);
  assert.match(ui.elements["wiki-citations"].children[0].textContent, /legacy\.txt/u);
  await ui.elements["wiki-citations"].children[0].dispatch("click");
  assert.equal(ui.elements["source-view"].children[1].textContent, "retained quote");
  assert.equal(ui.elements["file-input"].disabled, true);
  assert.equal(ui.elements["confirm-button"].disabled, true);
  ui.elements["file-input"].files = [uploadFile("new.txt", "not authorized")];
  await ui.elements["file-input"].dispatch("change");
  assert.deepEqual(urls, ["/api/corpus", "/api/topics/topic-1", `/api/documents/${encodeURIComponent(DIGEST_A)}`]);
});

test("selected empty active corpus never falls back to a legacy-looking source list", async () => {
  const urls = [];
  const ui = await startUi(async (url) => {
    urls.push(url);
    return jsonResponse(corpusResult({ active: null, sources: [{ name: "not-active.txt", sourceDigest: DIGEST_A }], topics: [{ id: "topic-1", title: "Not active" }], access: { uploads: false } }));
  });
  assert.equal(ui.elements["document-list"].children.length, 0);
  assert.equal(ui.elements["topic-tabs"].children.length, 0);
  assert.equal(ui.elements["wiki-status"].textContent, "当前没有已发布版本。");
  assert.deepEqual(urls, ["/api/corpus"]);
});

test("page is a document manager with fixed token-free native chat and reserved budget wording", async () => {
  const ui = await startUi(async () => jsonResponse(corpusResult({ active: activeResult() })));
  assert.equal(ui.elements["native-chat-link"].href, NATIVE_CHAT_URL);
  assert.equal(ui.elements["native-chat-link"].href.includes("token="), false);
  assert.match(ui.elements["budget-status"].textContent, /预留/u);
  assert.match(ui.elements["budget-status"].textContent, /100/u);
  assert.match(ui.elements["budget-status"].textContent, /87\.6/u);
  const html = await readFile(new URL("../docs/poc/course-wiki/index.html", import.meta.url), "utf8");
  assert.equal(/<form[^>]+question-form/u.test(html), false);
  assert.equal(html.includes("/api/questions"), false);
});

async function fixture(overrides = {}, serverOptions = {}) {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), "course-wiki-server-"));
  const resolvedOptions = { ...serverOptions };
  if (typeof resolvedOptions.liveAuthorization === "function") {
    resolvedOptions.liveAuthorization = resolvedOptions.liveAuthorization(root);
  }
  const app = await startCourseWikiServer({ root, operations: operations(overrides), ...resolvedOptions });
  app.root = root;
  cleanups.push(() => app.close(), () => rm(root, { recursive: true, force: true }));
  return { app };
}

function operations(overrides = {}) {
  return {
    normalizeDocument: async ({ name, bytes }) => ({ name, sourceDigest: DIGEST_A, text: bytes.toString("utf8"), lines: ["x"], originalBytes: bytes }),
    stageCourseCorpus: async () => stageResult(), activateCourseCorpus: async () => activeResult(),
    getCourseCorpus: async () => corpusResult(), getCourseDocument: async () => ({}), getCourseTopic: async () => ({}),
    ...overrides,
  };
}

function stageResult(overrides = {}) {
  return { generationId: GENERATION_A, corpusDigest: DIGEST_A, sources: [{ name: "lesson.txt", sourceDigest: DIGEST_A, characters: 6 }], totalCharacters: 6, status: "preview", duplicate: false, ...overrides };
}

function activeResult(overrides = {}) {
  return { generationId: GENERATION_A, corpusDigest: DIGEST_A, status: "active", duplicate: false, sources: [{ name: "lesson.txt", sourceDigest: DIGEST_A, characters: 6 }], topics: [{ id: "topic-1", title: "Old" }], budget: { reservedCny: 12.4, capCny: 100, remainingCny: 87.6 }, ...overrides };
}

function corpusResult(overrides = {}) {
  return { active: null, pending: [], budget: { reservedCny: 12.4, capCny: 100, remainingFen: 8760 }, model: "deepseek", access: { uploads: true, nativeChatUrl: NATIVE_CHAT_URL }, ...overrides };
}

function exactConsent(corpusDigest) { return { version: 1, corpusDigest, provider: "deepseek", purpose: "wiki-and-qa", confirmed: true }; }

function postJson(app, pathname, body) {
  return fetch(app.url + pathname, { method: "POST", headers: { Origin: app.url, "content-type": "application/json" }, body: JSON.stringify(body) });
}

function rawRequest(app, options = {}) {
  const url = new URL(app.url);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, method: options.method ?? "GET", path: options.path ?? "/", headers: options.headers }, resolve);
    request.on("error", reject);
    request.end(options.body);
  });
}

async function startUi(fetchImpl, ready) {
  const html = await readFile(new URL("../docs/poc/course-wiki/index.html", import.meta.url), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1];
  assert.ok(script);
  const ids = ["file-input", "drop-zone", "upload-status", "preview-status", "preview-summary", "preview-list", "confirm-button", "document-list", "topic-tabs", "topic-body", "wiki-status", "wiki-citations", "source-view", "budget-status", "native-chat-link"];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const document = { getElementById: (id) => elements[id], createElement: () => new FakeElement(), createElementNS: (uri) => new FakeElement(uri) };
  const ui = { elements };
  runInNewContext(script, { document, fetch: fetchImpl, btoa: (value) => Buffer.from(value, "binary").toString("base64") });
  await waitFor(() => elements["file-input"].listeners.has("change"));
  if (ready) await waitFor(() => ready(ui)); else await settle();
  return ui;
}

function uploadFile(name, value) { const bytes = Buffer.from(value); return { name, size: bytes.length, async arrayBuffer() { return bytes; } }; }
function jsonResponse(value, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => value }; }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }
async function waitFor(predicate) { for (let i = 0; i < 100; i += 1) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 0)); } assert.fail("UI did not reach expected state"); }

class FakeElement {
  constructor(namespaceURI = "http://www.w3.org/1999/xhtml") { this.namespaceURI = namespaceURI; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.classList = new FakeClassList(); this._textContent = ""; this.value = ""; this.disabled = false; this.href = ""; }
  get textContent() { return this._textContent; }
  set textContent(value) { this._textContent = String(value); this.children = []; }
  get firstElementChild() { return this.children[0] ?? null; }
  addEventListener(type, listener) { const listeners = this.listeners.get(type) ?? []; listeners.push(listener); this.listeners.set(type, listeners); }
  async dispatch(type, event = {}) { event.target ??= this; event.preventDefault ??= () => {}; await Promise.all((this.listeners.get(type) ?? []).map((listener) => listener(event))); }
  append(...children) { this._textContent = ""; this.children.push(...children); }
  replaceChildren(...children) { this._textContent = ""; this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) { if (force === true || (force === undefined && !this.values.has(value))) this.values.add(value); else this.values.delete(value); }
}
