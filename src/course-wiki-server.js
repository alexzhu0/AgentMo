import { createServer } from "node:http";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDocument } from "./course-wiki-documents.js";
import * as courseWikiRuntime from "./course-wiki-openclaw.js";

const PAGE_PATH = fileURLToPath(new URL("../docs/poc/course-wiki/index.html", import.meta.url));
const MAX_UPLOAD_BODY_BYTES = Math.ceil(10 * 2 * 1024 * 1024 * 4 / 3) + 64 * 1024;
const MAX_ACTION_BODY_BYTES = 8 * 1024;
const MAX_ENCODED_FILE_BYTES = Math.ceil(2 * 1024 * 1024 * 4 / 3) + 4;
const MAX_EXTRACTED_CHARACTERS = 100_000;
const NATIVE_CHAT_URL = "http://127.0.0.1:18789/chat/course-wiki";
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-should-retry": "false",
};
const defaultOperations = {
  normalizeDocument,
  stageCourseCorpus: courseWikiRuntime.stageCourseCorpus,
  activateCourseCorpus: courseWikiRuntime.activateCourseCorpus,
  getCourseCorpus: courseWikiRuntime.getCourseCorpus,
  getCourseDocument: courseWikiRuntime.getCourseDocument,
  getCourseTopic: courseWikiRuntime.getCourseTopic,
};

export async function startCourseWikiServer({
  root,
  liveAuthorization = null,
  apiKey = null,
  operations = defaultOperations,
  port = 0,
} = {}) {
  await validateRoot(root);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("Course Wiki port is invalid.");
  }
  const page = await readFile(PAGE_PATH);
  const server = createServer();
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on("request", (request, response) => {
    void routeRequest({
      request,
      response,
      root,
      liveAuthorization,
      apiKey,
      operations,
      page,
      expectedHost: `127.0.0.1:${server.address().port}`,
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    ))),
  };
}

async function routeRequest(context) {
  const { request, response, expectedHost } = context;
  try {
    if (request.headers.host !== expectedHost) return sendError(response, 403, "COURSE_WIKI_REQUEST_FORBIDDEN");
    const base = `http://${expectedHost}`;
    const url = new URL(request.url, base);
    if (url.origin !== base) return sendError(response, 403, "COURSE_WIKI_REQUEST_FORBIDDEN");
    if (request.method === "POST" && request.headers.origin !== base) {
      return sendError(response, 403, "COURSE_WIKI_REQUEST_FORBIDDEN");
    }

    if (request.method === "GET" && url.pathname === "/") {
      return send(response, 200, "text/html; charset=utf-8", context.page);
    }
    if (request.method === "GET" && url.pathname === "/api/corpus") {
      rejectQuery(url);
      const corpus = await callOperation(context.operations.getCourseCorpus, { root: context.root });
      const uploads = legacyLiveCampaign(context) ? false : corpus.access?.uploads !== false;
      return sendJson(response, 200, {
        ...corpus,
        access: { ...corpus.access, uploads, nativeChatUrl: NATIVE_CHAT_URL },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/documents") {
      rejectQuery(url);
      if (legacyLiveCampaign(context)) return sendError(response, 403, "COURSE_WIKI_LIVE_NOT_AUTHORIZED");
      const input = await readJson(request, MAX_UPLOAD_BODY_BYTES);
      if (!exactKeys(input, ["documents"])) throw new RequestError("COURSE_WIKI_REQUEST_INVALID", 400);
      const documents = await normalizeUpload(input, context.operations.normalizeDocument);
      const result = await callOperation(context.operations.stageCourseCorpus, { root: context.root, documents });
      return sendJson(response, 200, result);
    }

    const generationId = activationGenerationFrom(url.pathname);
    if (request.method === "POST" && generationId !== null) {
      rejectQuery(url);
      const consent = await readJson(request, MAX_ACTION_BODY_BYTES);
      if (!validConsent(consent)) throw new RequestError("COURSE_WIKI_CONSENT_INVALID", 403);
      const result = await callOperation(context.operations.activateCourseCorpus, {
        root: context.root,
        generationId,
        consent,
        liveAuthorization: context.liveAuthorization,
        apiKey: context.apiKey,
      });
      return sendJson(response, 200, result);
    }

    const documentDigest = documentDigestFrom(url.pathname);
    if (request.method === "GET" && documentDigest !== null) {
      const selectedGeneration = readGenerationQuery(url);
      const result = await callOperation(context.operations.getCourseDocument, {
        root: context.root,
        ...(selectedGeneration === null ? {} : { generationId: selectedGeneration }),
        sourceDigest: documentDigest,
      });
      return sendJson(response, 200, result);
    }
    const topicId = topicIdFrom(url.pathname);
    if (request.method === "GET" && topicId !== null) {
      const selectedGeneration = readGenerationQuery(url);
      const result = await callOperation(context.operations.getCourseTopic, {
        root: context.root,
        ...(selectedGeneration === null ? {} : { generationId: selectedGeneration }),
        id: topicId,
      });
      return sendJson(response, 200, result);
    }
    return sendError(response, 404, "COURSE_WIKI_ROUTE_NOT_FOUND");
  } catch (error) {
    const failure = publicFailure(error);
    return sendError(response, failure.status, failure.code);
  }
}

async function validateRoot(root) {
  if (typeof root !== "string" || !path.isAbsolute(root) || path.normalize(root) !== root) {
    throw new TypeError("Course Wiki root must be a canonical absolute path.");
  }
  const [info, resolved] = await Promise.all([lstat(root), realpath(root)]);
  if (!info.isDirectory() || info.isSymbolicLink() || resolved !== root) {
    throw new TypeError("Course Wiki root must be a canonical directory.");
  }
}

async function normalizeUpload(input, normalize) {
  if (!Array.isArray(input.documents) || input.documents.length === 0 || input.documents.length > 10) {
    throw new RequestError("COURSE_WIKI_DOCUMENT_BATCH_INVALID", 400);
  }
  const documents = [];
  let totalCharacters = 0;
  for (const item of input.documents) {
    if (!item || !exactKeys(item, ["base64", "name"])
      || typeof item.name !== "string" || typeof item.base64 !== "string") {
      throw new RequestError("COURSE_WIKI_DOCUMENT_INVALID", 400);
    }
    if (item.base64.length > MAX_ENCODED_FILE_BYTES) {
      throw new RequestError("COURSE_WIKI_DOCUMENT_TOO_LARGE", 413);
    }
    const document = await callOperation(normalize, { name: item.name, bytes: decodeBase64(item.base64) });
    totalCharacters += typeof document?.text === "string" ? document.text.length : 0;
    if (totalCharacters > MAX_EXTRACTED_CHARACTERS) {
      throw new RequestError("COURSE_WIKI_DOCUMENT_TEXT_TOO_LARGE", 413);
    }
    documents.push(document);
  }
  return documents;
}

function decodeBase64(value) {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new RequestError("COURSE_WIKI_DOCUMENT_INVALID", 400);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new RequestError("COURSE_WIKI_DOCUMENT_INVALID", 400);
  return bytes;
}

function activationGenerationFrom(pathname) {
  return new RegExp(`^/api/generations/(${UUID_PATTERN})/activate$`, "u").exec(pathname)?.[1] ?? null;
}

function documentDigestFrom(pathname) {
  const match = /^\/api\/documents\/(sha256(?::|%3A)[a-f0-9]{64})$/iu.exec(pathname);
  return match ? decodeURIComponent(match[1]).toLowerCase() : null;
}

function topicIdFrom(pathname) {
  return /^\/api\/topics\/(topic-\d+)$/u.exec(pathname)?.[1] ?? null;
}

function readGenerationQuery(url) {
  if ([...url.searchParams.keys()].some((key) => key !== "generationId")
    || url.searchParams.getAll("generationId").length > 1) {
    throw new RequestError("COURSE_WIKI_REQUEST_INVALID", 400);
  }
  const value = url.searchParams.get("generationId");
  if (value === null) return null;
  if (!new RegExp(`^${UUID_PATTERN}$`, "u").test(value)) {
    throw new RequestError("COURSE_WIKI_REQUEST_INVALID", 400);
  }
  return value;
}

function rejectQuery(url) {
  if (url.search.length !== 0) throw new RequestError("COURSE_WIKI_REQUEST_INVALID", 400);
}

function validConsent(value) {
  return exactKeys(value, ["confirmed", "corpusDigest", "provider", "purpose", "version"])
    && value.version === 1
    && /^sha256:[a-f0-9]{64}$/u.test(value.corpusDigest)
    && value.provider === "deepseek"
    && value.purpose === "wiki-and-qa"
    && value.confirmed === true;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function legacyLiveCampaign({ liveAuthorization, root }) {
  return liveAuthorization?.authorized === true
    && (liveAuthorization.campaign !== "course-wiki-selected-documents-v1" || liveAuthorization.root !== root);
}

function readJson(request, limit) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new RequestError("COURSE_WIKI_REQUEST_INVALID", 400);
  }
  const declared = Number(request.headers["content-length"]);
  if (request.headers["content-length"] !== undefined
    && (!Number.isSafeInteger(declared) || declared < 0 || declared > limit)) {
    throw new RequestError("COURSE_WIKI_REQUEST_TOO_LARGE", 413);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        request.removeAllListeners("data");
        request.pause();
        reject(new RequestError("COURSE_WIKI_REQUEST_TOO_LARGE", 413));
      } else chunks.push(chunk);
    });
    request.once("end", () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
        resolve(value);
      } catch {
        reject(new RequestError("COURSE_WIKI_REQUEST_INVALID", 400));
      }
    });
    request.once("error", reject);
  });
}

async function callOperation(operation, input) {
  if (typeof operation !== "function") throw new Error("Course Wiki runtime operation unavailable.");
  return operation(input);
}

function publicFailure(error) {
  if (error instanceof RequestError) return error;
  const code = typeof error?.code === "string" && /^COURSE_WIKI_[A-Z0-9_]+$/u.test(error.code)
    ? error.code : "COURSE_WIKI_SERVER_FAILURE";
  if (["COURSE_WIKI_REQUEST_INVALID", "COURSE_WIKI_EVIDENCE_TOO_LARGE"].includes(code)) return { status: 400, code };
  if (["COURSE_WIKI_CONSENT_INVALID", "COURSE_WIKI_CONSENT_REJECTED", "COURSE_WIKI_LIVE_NOT_AUTHORIZED"].includes(code)) {
    return { status: 403, code };
  }
  if (code === "COURSE_WIKI_OPERATION_BUSY") return { status: 409, code };
  if (code.includes("TOO_LARGE")) return { status: 413, code };
  if (error?.name === "CourseWikiDocumentError" || code.includes("DOCUMENT_")) return { status: 400, code };
  if (code.includes("BUDGET") || code.includes("ALLOWANCE")) return { status: 429, code };
  if (code.includes("NATIVE") || code.includes("MODEL") || code.includes("UPSTREAM") || code === "COURSE_WIKI_RUNTIME_REJECTED") {
    return { status: 502, code };
  }
  return { status: 500, code: "COURSE_WIKI_SERVER_FAILURE" };
}

function sendError(response, status, code) { sendJson(response, status, { error: { code } }); }
function sendJson(response, status, value) { send(response, status, "application/json; charset=utf-8", Buffer.from(`${JSON.stringify(value)}\n`)); }
function send(response, status, contentType, body) {
  response.writeHead(status, { ...SECURITY_HEADERS, connection: "close", "content-type": contentType });
  response.end(body);
}

class RequestError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
