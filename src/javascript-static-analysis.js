const FS_WRITERS = new Set([
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "writeFile",
  "writeFileSync",
]);
const FS_READERS = new Set([
  "access",
  "createReadStream",
  "fstatSync",
  "lstat",
  "opendir",
  "readFile",
  "readFileSync",
  "readlink",
  "readdir",
  "realpath",
  "stat",
]);
const FS_LIFECYCLE = new Set([
  "chmod",
  "link",
  "mkdir",
  "mkdtemp",
  "rename",
  "rm",
  "rmdir",
  "unlink",
]);
const SOURCE_INTAKE_READERS = new Set(["readFile", "realpath", "stat"]);
const SOURCE_INTAKE_IO_METHODS = new Set(["lstat", "open", "realpath"]);
const PERSISTABILITY_WRITERS = new Set([
  "writePersistableJsonAtomic",
  "writePersistableProductTextAtomic",
  "writePersistableTextAtomic",
]);
const HANDLE_WRITERS = new Set(["appendFile", "createWriteStream", "write", "writeFile"]);
const HANDLE_READERS = new Set(["read", "readFile", "stat"]);
const HANDLE_LIFECYCLE = new Set(["sync", "truncate"]);
const STREAM_WRITERS = new Set(["end", "pipe"]);
const CONSOLE_METHODS = new Set(["log", "error", "warn", "info", "debug"]);
const CHILD_PROCESS_EXECUTORS = new Set([
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "fork",
  "spawn",
  "spawnSync",
]);
const ASSIGNMENT_OPERATORS = new Set([
  "=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "&&=", "||=", "??=",
]);

export class JavaScriptStaticAnalysisError extends Error {
  constructor() {
    super("JavaScript source could not be completely classified.");
    this.name = "JavaScriptStaticAnalysisError";
    this.code = "AGENTMO_JAVASCRIPT_STATIC_ANALYSIS_REJECTED";
  }
}

export function analyzeJavaScriptSource(source, options = {}) {
  if (typeof source !== "string"
    || options === null
    || typeof options !== "object"
    || Array.isArray(options)
    || (options.includeProcessEffects !== undefined
      && typeof options.includeProcessEffects !== "boolean")) {
    reject();
  }
  const file = typeof options.file === "string" && options.file.length > 0
    ? options.file
    : "fixture.js";
  const tokens = tokenizeJavaScript(source);
  const pairs = buildDelimiterPairs(tokens);
  const imports = analyzeModuleSyntax(tokens, pairs);
  const declarations = analyzeDeclarations(tokens, pairs, imports.bindings);
  if (options.includeProcessEffects === true) {
    assertProcessGlobalIsUnshadowed(tokens, pairs, imports.bindings);
  }
  const calls = collectCalls(tokens, pairs);
  const constBindings = analyzeConstBindings(tokens, pairs);
  const loaders = analyzeLoaders(tokens, pairs, imports, declarations, calls);
  const ioSurfaces = analyzeIo(
    tokens,
    pairs,
    imports,
    declarations,
    calls,
    file,
    options.includeProcessEffects === true,
  );
  const processInvocations = options.includeProcessEffects === true
    ? analyzeProcessInvocations(tokens, pairs, declarations, calls)
    : [];
  return Object.freeze({
    loaders: Object.freeze(loaders.map((record) => Object.freeze(record))),
    ioSurfaces: Object.freeze(ioSurfaces.map((record) => Object.freeze(record))),
    processInvocations: Object.freeze(processInvocations.map((record) => Object.freeze(record))),
    constBindings: Object.freeze(constBindings.map((record) => Object.freeze(record))),
  });
}

function assertProcessGlobalIsUnshadowed(tokens, pairs, imports) {
  if (imports.has("process")) reject();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isPunctuator(token, "(")) {
      const closeIndex = pairs.forward.get(index);
      if (closeIndex === undefined) reject();
      if (isPunctuator(tokens[closeIndex + 1], "=>")
        || isMethodParameterList(tokens, index, closeIndex)) {
        assertParameterListDoesNotBindProcess(tokens, index + 1, closeIndex);
      }
      continue;
    }
    if (token?.type !== "identifier") continue;
    if (["const", "let", "var"].includes(token.value)
      && tokens[index + 1]?.type === "identifier" && tokens[index + 1].value === "process") {
      reject();
    }
    if (token.value === "catch" && isPunctuator(tokens[index + 1], "(")
      && tokens[index + 2]?.type === "identifier" && tokens[index + 2].value === "process") {
      reject();
    }
    if (token.value === "function") {
      let openIndex = index + 1;
      if (tokens[openIndex]?.type === "identifier") openIndex += 1;
      if (!isPunctuator(tokens[openIndex], "(")) continue;
      const closeIndex = pairs.forward.get(openIndex);
      if (closeIndex === undefined) reject();
      assertParameterListDoesNotBindProcess(tokens, openIndex + 1, closeIndex);
    }
    if (token.value === "process" && isPunctuator(tokens[index + 1], "=>")) reject();
  }
}

function isMethodParameterList(tokens, openIndex, closeIndex) {
  if (!isPunctuator(tokens[closeIndex + 1], "{")) return false;
  const previous = tokens[openIndex - 1];
  if (previous?.type !== "identifier") return false;
  return !new Set(["if", "for", "while", "switch", "catch", "with", "await"]).has(previous.value);
}

function assertParameterListDoesNotBindProcess(tokens, startIndex, endIndex) {
  for (let index = startIndex; index < endIndex; index += 1) {
    if (tokens[index]?.type === "identifier" && tokens[index].value === "process"
      && !isPunctuator(tokens[index - 1], ".")
      && !isPunctuator(tokens[index - 1], "?.")) {
      reject();
    }
  }
}

function analyzeModuleSyntax(tokens, pairs) {
  const loaders = [];
  const bindings = new Map();
  const bindingTokenIndexes = new Set();
  const syntaxTokenIndexes = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || !["import", "export"].includes(token.value)) continue;
    const previous = tokens[index - 1];
    if (previous?.type === "punctuator" && [".", "?."].includes(previous.value)) continue;
    if (token.value === "import") {
      const parsed = parseImport(tokens, pairs, index);
      syntaxTokenIndexes.add(index);
      for (let cursor = index; cursor <= parsed.endIndex; cursor += 1) syntaxTokenIndexes.add(cursor);
      if (parsed.kind !== "meta") {
        loaders.push(loaderRecord(parsed.kind, parsed.specifier, token.line));
      }
      for (const binding of parsed.bindings) {
        if (bindings.has(binding.local)) reject();
        bindings.set(binding.local, Object.freeze({
          module: parsed.specifier,
          imported: binding.imported,
          kind: binding.kind,
        }));
        bindingTokenIndexes.add(binding.tokenIndex);
      }
      index = parsed.endIndex;
      continue;
    }
    const parsed = parseExport(tokens, index);
    syntaxTokenIndexes.add(index);
    for (let cursor = index; cursor <= parsed.endIndex; cursor += 1) syntaxTokenIndexes.add(cursor);
    if (parsed.specifier !== null) loaders.push(loaderRecord("export-from", parsed.specifier, token.line));
    index = parsed.endIndex;
  }
  return { loaders, bindings, bindingTokenIndexes, syntaxTokenIndexes };
}

function parseImport(tokens, pairs, index) {
  const next = tokens[index + 1];
  if (next?.type === "punctuator" && next.value === ".") {
    if (tokens[index + 2]?.type !== "identifier" || tokens[index + 2].value !== "meta") reject();
    return { kind: "meta", specifier: null, bindings: [], endIndex: index + 2 };
  }
  if (next?.type === "punctuator" && next.value === "(") {
    const closeIndex = pairs.forward.get(index + 1);
    if (closeIndex === undefined) reject();
    const specifier = singlePlainStringArgument(tokens, index + 1, closeIndex);
    return { kind: "dynamic-import", specifier, bindings: [], endIndex: closeIndex };
  }
  if (tokens[index].braceDepth !== 0) reject();
  if (next?.type === "string") {
    return {
      kind: "static-import",
      specifier: plainString(next),
      bindings: [],
      endIndex: index + 1,
    };
  }

  let cursor = index + 1;
  const bindings = [];
  const first = tokens[cursor];
  let clauseSeparator = false;
  if (first?.type === "identifier") {
    bindings.push({ local: first.value, imported: "default", kind: "default", tokenIndex: cursor });
    cursor += 1;
    if (isPunctuator(tokens[cursor], ",")) {
      clauseSeparator = true;
      cursor += 1;
    }
  }
  if (isPunctuator(tokens[cursor], "*")) {
    if (first?.type === "identifier" && !clauseSeparator) reject();
    if (tokens[cursor + 1]?.type !== "identifier" || tokens[cursor + 1].value !== "as"
      || tokens[cursor + 2]?.type !== "identifier") reject();
    bindings.push({
      local: tokens[cursor + 2].value,
      imported: "*",
      kind: "namespace",
      tokenIndex: cursor + 2,
    });
    cursor += 3;
  } else if (isPunctuator(tokens[cursor], "{")) {
    const closeIndex = findMatchingBrace(tokens, cursor);
    bindings.push(...parseNamedBindings(tokens, cursor + 1, closeIndex));
    cursor = closeIndex + 1;
  } else if (cursor === index + 1 || first?.type !== "identifier") {
    reject();
  }
  if (tokens[cursor]?.type !== "identifier" || tokens[cursor].value !== "from") reject();
  const specifier = plainString(tokens[cursor + 1]);
  return { kind: "static-import", specifier, bindings, endIndex: cursor + 1 };
}

function parseNamedBindings(tokens, start, end) {
  const bindings = [];
  let cursor = start;
  while (cursor < end) {
    if (isPunctuator(tokens[cursor], ",")) {
      cursor += 1;
      continue;
    }
    const imported = tokens[cursor];
    if (imported?.type !== "identifier") reject();
    let local = imported;
    cursor += 1;
    if (tokens[cursor]?.type === "identifier" && tokens[cursor].value === "as") {
      local = tokens[cursor + 1];
      if (local?.type !== "identifier") reject();
      cursor += 2;
    }
    bindings.push({
      local: local.value,
      imported: imported.value,
      kind: "named",
      tokenIndex: tokens.indexOf(local),
    });
    if (cursor < end && !isPunctuator(tokens[cursor], ",")) reject();
  }
  return bindings;
}

function parseExport(tokens, index) {
  if (tokens[index].braceDepth !== 0) reject();
  const next = tokens[index + 1];
  if (!next) reject();
  if (isPunctuator(next, "*")) {
    let cursor = index + 2;
    if (tokens[cursor]?.type === "identifier" && tokens[cursor].value === "as") {
      if (tokens[cursor + 1]?.type !== "identifier") reject();
      cursor += 2;
    }
    if (tokens[cursor]?.type !== "identifier" || tokens[cursor].value !== "from") reject();
    return { specifier: plainString(tokens[cursor + 1]), endIndex: cursor + 1 };
  }
  if (isPunctuator(next, "{")) {
    const closeIndex = findMatchingBrace(tokens, index + 1);
    const from = tokens[closeIndex + 1];
    return from?.type === "identifier" && from.value === "from"
      ? { specifier: plainString(tokens[closeIndex + 2]), endIndex: closeIndex + 2 }
      : { specifier: null, endIndex: closeIndex };
  }
  if (next.type !== "identifier") reject();
  if (["default", "const", "let", "var", "function", "class"].includes(next.value)) {
    return { specifier: null, endIndex: index + 1 };
  }
  if (next.value === "async" && tokens[index + 2]?.type === "identifier"
    && tokens[index + 2].value === "function") {
    return { specifier: null, endIndex: index + 2 };
  }
  reject();
}

function analyzeDeclarations(tokens, pairs, bindings) {
  const createRequireAliases = new Set();
  const createRequireDeclarations = new Map();
  const handleNames = new Set();
  const processOutputAliases = new Map();
  const consoleAliases = new Set();
  const fsNamespaces = new Set();
  const fsNamed = new Map();
  const persistabilityNamed = new Map();
  const loaderBindings = new Map();
  const childProcessNamespaces = new Set();
  const childProcessNamed = new Map();
  const childProcessHandles = new Set();
  const declarationTokenIndexes = new Set();

  for (const [local, binding] of bindings) {
    if (["node:fs", "node:fs/promises"].includes(binding.module)) {
      if (binding.kind === "namespace" || binding.kind === "default") fsNamespaces.add(local);
      else fsNamed.set(local, binding.imported);
    }
    if (binding.module.endsWith("persistability.js") && binding.kind === "named") {
      persistabilityNamed.set(local, binding.imported);
    }
    if (binding.module === "node:module"
      && (binding.imported === "createRequire" || binding.kind === "namespace")) {
      loaderBindings.set(local, binding.imported === "createRequire" ? "createRequire" : "module-namespace");
    }
    if (binding.module === "node:worker_threads"
      && (binding.imported === "Worker" || binding.kind === "namespace")) {
      loaderBindings.set(local, binding.imported === "Worker" ? "worker" : "worker-namespace");
    }
    if (binding.module === "node:child_process"
      && (binding.imported === "fork" || binding.kind === "namespace")) {
      loaderBindings.set(local, binding.imported === "fork" ? "fork" : "child-process-namespace");
    }
    if (binding.module === "node:child_process") {
      if (binding.kind === "namespace" || binding.kind === "default") {
        childProcessNamespaces.add(local);
      } else if (CHILD_PROCESS_EXECUTORS.has(binding.imported)) {
        childProcessNamed.set(local, binding.imported);
      }
    }
    if (binding.module === "node:vm") loaderBindings.set(local, "vm");
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.type !== "identifier" || !["const", "let", "var"].includes(tokens[index].value)) continue;
    const left = tokens[index + 1];
    if (left?.type !== "identifier" || !isPunctuator(tokens[index + 2], "=")) continue;
    declarationTokenIndexes.add(index + 1);
    let rhs = index + 3;
    if (tokens[rhs]?.type === "identifier" && tokens[rhs].value === "await") rhs += 1;
    const openIndex = findImmediateCallOpen(tokens, rhs);
    if (openIndex !== null) {
      const callee = parseCallee(tokens, pairs, openIndex);
      const closeIndex = pairs.forward.get(openIndex);
      if (callee && closeIndex !== undefined) {
        if (isCreateRequireCallee(callee, loaderBindings)) {
          requireImportMetaUrl(tokens, openIndex, closeIndex);
          createRequireAliases.add(left.value);
          createRequireDeclarations.set(left.value, Object.freeze({
            leftIndex: index + 1,
            calleeTokenIndexes: callee.tokenIndexes,
          }));
        }
        const required = loaderSpecifierForCallee(callee, createRequireAliases);
        if (required && ["node:fs", "node:fs/promises"].includes(
          literalFirstArgument(tokens, openIndex, closeIndex, false),
        )) {
          fsNamespaces.add(left.value);
        }
        if (isFsOpenCallee(callee, fsNamed, fsNamespaces)) handleNames.add(left.value);
        if (callee.base === "openInput" && callee.properties.length === 0) handleNames.add(left.value);
        if (childProcessExecutionMethod(callee, childProcessNamed, childProcessNamespaces) !== null) {
          childProcessHandles.add(left.value);
        }
      }
    }
    if (tokens[rhs]?.type === "identifier" && tokens[rhs].value === "process") {
      const member = parseSimpleMember(tokens, rhs);
      if (member && ["stdout", "stderr"].includes(member.property)) {
        processOutputAliases.set(left.value, member.property);
      }
    }
    if (tokens[rhs]?.type === "identifier" && tokens[rhs].value === "console") {
      consoleAliases.add(left.value);
    }
    const rhsToken = tokens[rhs];
    if (rhsToken?.type === "identifier"
      && (fsNamespaces.has(rhsToken.value) || fsNamed.has(rhsToken.value))
      && !isPunctuator(tokens[rhs + 1], "(")
      && !isPunctuator(tokens[rhs + 1], ".")
      && !isPunctuator(tokens[rhs + 1], "?.")
      && !isPunctuator(tokens[rhs + 1], "[")) {
      reject();
    }
  }

  return {
    createRequireAliases,
    createRequireDeclarations,
    handleNames,
    processOutputAliases,
    consoleAliases,
    fsNamespaces,
    fsNamed,
    persistabilityNamed,
    loaderBindings,
    childProcessNamespaces,
    childProcessNamed,
    childProcessHandles,
    declarationTokenIndexes,
  };
}

function analyzeLoaders(tokens, pairs, imports, declarations, calls) {
  const records = [...imports.loaders];
  const allowedLoaderReferences = new Set(imports.bindingTokenIndexes);
  for (const declaration of declarations.createRequireDeclarations.values()) {
    allowedLoaderReferences.add(declaration.leftIndex);
    for (const index of declaration.calleeTokenIndexes) allowedLoaderReferences.add(index);
  }

  for (const call of calls) {
    const { callee, openIndex, closeIndex } = call;
    if (callee.base === "import" && callee.properties.length === 0) continue;
    if ((callee.base === "eval" && callee.properties.length === 0)
      || (callee.base === "Function" && callee.properties.length === 0)) reject();
    if (callee.base === "process" && callee.properties.join(".") === "dlopen") reject();

    const requireKind = loaderSpecifierForCallee(callee, declarations.createRequireAliases);
    if (requireKind) {
      const specifier = singlePlainStringArgument(tokens, openIndex, closeIndex);
      records.push(loaderRecord(requireKind, specifier, callee.line));
      for (const index of callee.tokenIndexes) allowedLoaderReferences.add(index);
      continue;
    }

    if (isCreateRequireCallee(callee, declarations.loaderBindings)) {
      const declaration = [...declarations.createRequireDeclarations.values()].find((item) => (
        item.calleeTokenIndexes.every((tokenIndex, offset) => tokenIndex === callee.tokenIndexes[offset])
      ));
      if (!declaration) reject();
      continue;
    }

    const workerKind = workerLoaderKind(callee, declarations.loaderBindings, tokens, openIndex);
    if (workerKind !== null) {
      const specifier = literalFirstArgument(tokens, openIndex, closeIndex, true);
      records.push(loaderRecord(workerKind, specifier, callee.line));
      for (const index of callee.tokenIndexes) allowedLoaderReferences.add(index);
      continue;
    }

    const bindingKind = declarations.loaderBindings.get(callee.base);
    if (bindingKind === "module-namespace" && callee.properties[0] !== "createRequire") reject();
    if (bindingKind === "vm") reject();
    if (bindingKind === "worker-namespace" && callee.properties[0] !== "Worker") reject();
    if (bindingKind === "child-process-namespace" && callee.properties[0] === "fork") reject();
  }

  const strictLoaderNames = new Set([
    ...declarations.createRequireAliases,
    ...[...declarations.loaderBindings.entries()]
      .filter(([, kind]) => ["createRequire", "worker", "fork"].includes(kind))
      .map(([name]) => name),
  ]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || !strictLoaderNames.has(token.value)) continue;
    if (allowedLoaderReferences.has(index)) continue;
    if (imports.syntaxTokenIndexes.has(index)) continue;
    const previous = tokens[index - 1];
    if (isPunctuator(previous, ".") || isPunctuator(previous, "?.")) continue;
    reject();
  }
  return deduplicate(records, (record) => `${record.kind}:${record.line}:${record.specifier}`);
}

function analyzeIo(tokens, pairs, imports, declarations, calls, file, includeProcessEffects) {
  const surfaces = [];
  const allowedChildProcessReferences = new Set(imports.bindingTokenIndexes);
  const protectedFsNames = new Set([
    ...declarations.fsNamespaces,
    ...declarations.fsNamed.keys(),
    ...declarations.childProcessNamespaces,
    ...declarations.childProcessNamed.keys(),
  ]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || !protectedFsNames.has(token.value)) continue;
    if (ASSIGNMENT_OPERATORS.has(tokens[index + 1]?.value)
      || ["++", "--"].includes(tokens[index - 1]?.value)
      || ["++", "--"].includes(tokens[index + 1]?.value)) reject();
  }

  for (const call of calls) {
    const { callee, openIndex, closeIndex } = call;
    const method = callee.properties.at(-1) ?? null;
    if (callee.dynamicProperty && declarations.fsNamespaces.has(callee.base)) reject();

    if (callee.properties.length === 0 && declarations.fsNamed.has(callee.base)) {
      classifyFsMethod(surfaces, file, callee.line, declarations.fsNamed.get(callee.base), callee.base);
      continue;
    }
    if (declarations.fsNamespaces.has(callee.base)) {
      if (callee.dynamicProperty) reject();
      const properties = callee.properties;
      const fsMethod = properties.length === 1
        ? properties[0]
        : properties.length === 2 && properties[0] === "promises"
          ? properties[1]
          : null;
      if (fsMethod === null) reject();
      classifyFsMethod(surfaces, file, callee.line, fsMethod, callee.base);
      continue;
    }
    const executionMethod = childProcessExecutionMethod(
      callee,
      declarations.childProcessNamed,
      declarations.childProcessNamespaces,
    );
    if (executionMethod !== null) {
      for (const tokenIndex of callee.tokenIndexes) allowedChildProcessReferences.add(tokenIndex);
      if (includeProcessEffects) {
        const kind = executionMethod === "fork"
          ? "process-fork"
          : executionMethod.startsWith("spawn")
            ? "process-spawn"
            : "process-exec";
        surfaces.push(surface(file, callee.line, kind, `child_process.${executionMethod}`));
      }
      continue;
    }
    if (includeProcessEffects
      && declarations.childProcessHandles.has(callee.base)
      && callee.properties.length === 1
      && method === "kill") {
      surfaces.push(surface(file, callee.line, "process-control", "ChildProcess.kill"));
      continue;
    }
    if (callee.properties.length === 0 && declarations.persistabilityNamed.has(callee.base)) {
      const original = declarations.persistabilityNamed.get(callee.base);
      if (PERSISTABILITY_WRITERS.has(original)) {
        surfaces.push(surface(file, callee.line, "managed-writer", `persistability.${original}`));
        continue;
      }
    }
    if (callee.base === "openInput" && callee.properties.length === 0) {
      surfaces.push(surface(file, callee.line, "filesystem-open", "file.openInput"));
      continue;
    }
    if (callee.base === "sourceIntakeIo" && callee.properties.length === 1) {
      if (!SOURCE_INTAKE_IO_METHODS.has(method)) reject();
      surfaces.push(surface(file, callee.line, "non-artifact-intake", `sourceIntakeIo.${method}`));
      continue;
    }
    if (callee.properties.length === 0 && /^loadAdmitted[A-Za-z0-9_$]*$/u.test(callee.base)) {
      if (!isFunctionDeclarationCall(tokens, callee.tokenIndexes[0])) {
        surfaces.push(surface(file, callee.line, "durable-loader", callee.base));
      }
      continue;
    }
    if (callee.base === "emitPersistableOutput" && callee.properties.length === 0) {
      if (!isFunctionDeclarationCall(tokens, callee.tokenIndexes[0])) {
        surfaces.push(surface(file, callee.line, "serializer-to-sink", "emitPersistableOutput"));
      }
      continue;
    }
    if (callee.base === "sink" && callee.properties.length === 0
      && tokens[openIndex + 1]?.type === "identifier"
      && tokens[openIndex + 1].value === "formatted"
      && openIndex + 2 === closeIndex) {
      surfaces.push(surface(file, callee.line, "serializer-to-sink", "sink"));
      continue;
    }
    if (callee.base === "process" && callee.properties.length === 2
      && ["stdout", "stderr"].includes(callee.properties[0]) && method === "write") {
      surfaces.push(surface(file, callee.line, "process-output", `process.${callee.properties[0]}.write`));
      continue;
    }
    if (declarations.processOutputAliases.has(callee.base)
      && callee.properties.length === 1 && method === "write") {
      surfaces.push(surface(
        file,
        callee.line,
        "process-output",
        `process.${declarations.processOutputAliases.get(callee.base)}.write`,
      ));
      continue;
    }
    if ((callee.base === "console" || declarations.consoleAliases.has(callee.base))
      && callee.properties.length === 1 && CONSOLE_METHODS.has(method)) {
      surfaces.push(surface(file, callee.line, "console-output", `console.${method}`));
      continue;
    }

    const receiver = callee.properties.length >= 2
      ? callee.properties.at(-2)
      : callee.base;
    const looksLikeHandle = declarations.handleNames.has(callee.base)
      || /^handle$/iu.test(receiver ?? "")
      || /Handle$/u.test(receiver ?? "");
    if (looksLikeHandle && HANDLE_WRITERS.has(method)) {
      surfaces.push(surface(file, callee.line, "file-handle", `FileHandle.${method}`));
      continue;
    }
    if (looksLikeHandle && HANDLE_READERS.has(method)) {
      surfaces.push(surface(file, callee.line, "file-handle-read", `FileHandle.${method}`));
      continue;
    }
    if (looksLikeHandle && HANDLE_LIFECYCLE.has(method)) {
      surfaces.push(surface(file, callee.line, "file-handle-lifecycle", `FileHandle.${method}`));
      continue;
    }
    if (HANDLE_WRITERS.has(method)) {
      surfaces.push(surface(file, callee.line, "managed-writer", `${receiver}.${method}`));
      continue;
    }
    if (FS_LIFECYCLE.has(method)) {
      surfaces.push(surface(file, callee.line, "managed-filesystem", `${receiver}.${method}`));
      continue;
    }
    if (STREAM_WRITERS.has(method)) {
      surfaces.push(surface(file, callee.line, "stream-write", `${receiver}.${method}`));
    }
  }

  if (includeProcessEffects) {
    const protectedNames = new Set([
      ...declarations.childProcessNamespaces,
      ...declarations.childProcessNamed.keys(),
    ]);
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type !== "identifier" || !protectedNames.has(token.value)) continue;
      if (!allowedChildProcessReferences.has(index)) reject();
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.type !== "string" || tokens[index].value !== "write-file") continue;
    const operator = tokens[index - 1];
    const discriminator = tokens[index - 2];
    if ((isPunctuator(operator, ":") || ["==", "===", "!=", "!=="].includes(operator?.value))
      && ["identifier", "string"].includes(discriminator?.type)
      && ["type", "kind"].includes(discriminator.value)) {
      surfaces.push(surface(file, tokens[index].line, "managed-operation", "operation:write-file"));
    }
  }
  return deduplicate(surfaces, (record) => `${record.file}:${record.line}:${record.kind}:${record.callee}`)
    .sort(compareSurfaces);
}

function analyzeProcessInvocations(tokens, pairs, declarations, calls) {
  const invocations = [];
  for (const call of calls) {
    const method = childProcessExecutionMethod(
      call.callee,
      declarations.childProcessNamed,
      declarations.childProcessNamespaces,
    );
    if (method === null) continue;
    const argumentsList = parseCallArguments(tokens, pairs, call.openIndex, call.closeIndex);
    if (argumentsList === null) reject();
    invocations.push(Object.freeze({
      method,
      line: call.callee.line,
      arguments: Object.freeze(argumentsList),
    }));
  }
  return invocations;
}

function analyzeConstBindings(tokens, pairs) {
  const bindings = [];
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    if (tokens[index]?.type !== "identifier" || tokens[index].value !== "const"
      || tokens[index + 1]?.type !== "identifier" || !isPunctuator(tokens[index + 2], "=")) {
      continue;
    }
    const endIndex = findStatementEnd(tokens, pairs, index + 3, tokens[index].braceDepth);
    if (endIndex === null) continue;
    const value = parseClosedExpression(tokens, pairs, index + 3, endIndex);
    if (value !== null) {
      bindings.push(Object.freeze({
        name: tokens[index + 1].value,
        line: tokens[index + 1].line,
        value,
      }));
    }
  }
  return bindings;
}

function findStatementEnd(tokens, pairs, startIndex, braceDepth) {
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (["(", "[", "{"] .includes(tokens[index]?.value)) {
      const close = pairs.forward.get(index);
      if (close === undefined) return null;
      index = close;
      continue;
    }
    if (isPunctuator(tokens[index], ";") && tokens[index].braceDepth === braceDepth) return index;
  }
  return null;
}

function parseCallArguments(tokens, pairs, openIndex, closeIndex) {
  const ranges = splitTopLevelArguments(tokens, pairs, openIndex + 1, closeIndex);
  if (ranges === null) return null;
  const values = [];
  for (const [startIndex, endIndex] of ranges) {
    const value = parseClosedExpression(tokens, pairs, startIndex, endIndex);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function splitTopLevelArguments(tokens, pairs, startIndex, endIndex) {
  if (startIndex === endIndex) return [];
  const ranges = [];
  let start = startIndex;
  for (let index = startIndex; index < endIndex; index += 1) {
    if (["(", "[", "{"] .includes(tokens[index]?.value)) {
      const close = pairs.forward.get(index);
      if (close === undefined || close >= endIndex) return null;
      index = close;
      continue;
    }
    if (isPunctuator(tokens[index], ",")) {
      if (start === index) return null;
      ranges.push([start, index]);
      start = index + 1;
    }
  }
  if (start === endIndex) {
    return isPunctuator(tokens[endIndex - 1], ",") ? ranges : null;
  }
  ranges.push([start, endIndex]);
  return ranges;
}

function parseClosedExpression(tokens, pairs, startIndex, endIndex) {
  if (startIndex >= endIndex) return null;
  const first = tokens[startIndex];
  if (first?.type === "string" && startIndex + 1 === endIndex && !first.escaped) {
    return Object.freeze({ type: "string", value: first.value });
  }
  if (first?.type === "identifier") {
    const path = [first.value];
    let cursor = startIndex + 1;
    while (cursor + 1 < endIndex && isPunctuator(tokens[cursor], ".")
      && tokens[cursor + 1]?.type === "identifier") {
      path.push(tokens[cursor + 1].value);
      cursor += 2;
    }
    if (cursor === endIndex) return Object.freeze({ type: "member", path: Object.freeze(path) });
    if (isPunctuator(tokens[cursor], "(") && pairs.forward.get(cursor) === endIndex - 1) {
      const argumentsList = parseCallArguments(tokens, pairs, cursor, endIndex - 1);
      if (argumentsList === null) return null;
      return Object.freeze({
        type: "call",
        callee: Object.freeze(path),
        arguments: Object.freeze(argumentsList),
      });
    }
  }
  if (isPunctuator(first, "[") && pairs.forward.get(startIndex) === endIndex - 1) {
    const elements = splitTopLevelArguments(tokens, pairs, startIndex + 1, endIndex - 1);
    if (elements === null) return null;
    const values = [];
    for (const [elementStart, elementEnd] of elements) {
      const value = parseClosedExpression(tokens, pairs, elementStart, elementEnd);
      if (value === null) return null;
      values.push(value);
    }
    return Object.freeze({ type: "array", values: Object.freeze(values) });
  }
  if (isPunctuator(first, "{") && pairs.forward.get(startIndex) === endIndex - 1) {
    const entries = splitTopLevelArguments(tokens, pairs, startIndex + 1, endIndex - 1);
    if (entries === null) return null;
    const properties = [];
    for (const [propertyStart, propertyEnd] of entries) {
      const key = tokens[propertyStart];
      if (!key || !["identifier", "string"].includes(key.type)
        || (key.type === "string" && key.escaped)
        || !isPunctuator(tokens[propertyStart + 1], ":")) return null;
      const value = parseClosedExpression(tokens, pairs, propertyStart + 2, propertyEnd);
      if (value === null) return null;
      properties.push(Object.freeze({ key: key.value, value }));
    }
    return Object.freeze({ type: "object", properties: Object.freeze(properties) });
  }
  return null;
}

function classifyFsMethod(surfaces, file, line, method, localName) {
  if (SOURCE_INTAKE_READERS.has(method) && localName.startsWith("sourceIntake")) {
    surfaces.push(surface(file, line, "non-artifact-intake", `fs.${method}`));
  } else if (FS_READERS.has(method)) {
    surfaces.push(surface(file, line, "filesystem-read", `fs.${method}`));
  } else if (method === "open") {
    surfaces.push(surface(file, line, "filesystem-open", "fs.open"));
  } else if (FS_LIFECYCLE.has(method)) {
    surfaces.push(surface(file, line, "filesystem-lifecycle", `fs.${method}`));
  } else if (FS_WRITERS.has(method)) {
    surfaces.push(surface(file, line, "filesystem", `fs.${method}`));
  } else if (method !== "constants") {
    reject();
  }
}

function collectCalls(tokens, pairs) {
  const calls = [];
  for (let openIndex = 0; openIndex < tokens.length; openIndex += 1) {
    if (!isPunctuator(tokens[openIndex], "(")) continue;
    const closeIndex = pairs.forward.get(openIndex);
    if (closeIndex === undefined) reject();
    const callee = parseCallee(tokens, pairs, openIndex);
    if (callee) calls.push({ callee, openIndex, closeIndex });
  }
  return calls;
}

function parseCallee(tokens, pairs, openIndex) {
  let endIndex = openIndex - 1;
  if (isPunctuator(tokens[endIndex], "?.")) endIndex -= 1;
  const parsed = parseReceiverEndingAt(tokens, pairs, endIndex);
  if (!parsed) return null;
  return Object.freeze({ ...parsed, line: tokens[parsed.tokenIndexes[0]].line });
}

function parseReceiverEndingAt(tokens, pairs, endIndex) {
  const token = tokens[endIndex];
  if (!token) return null;
  if (token.type === "identifier") {
    const operator = tokens[endIndex - 1];
    if (isPunctuator(operator, ".") || isPunctuator(operator, "?.")) {
      const left = parseReceiverEndingAt(tokens, pairs, endIndex - 2);
      if (!left) return null;
      return {
        base: left.base,
        properties: [...left.properties, token.value],
        dynamicProperty: left.dynamicProperty,
        tokenIndexes: [...left.tokenIndexes, endIndex],
      };
    }
    return { base: token.value, properties: [], dynamicProperty: false, tokenIndexes: [endIndex] };
  }
  if (isPunctuator(token, "]")) {
    const openIndex = pairs.reverse.get(endIndex);
    if (openIndex === undefined) return null;
    let leftEnd = openIndex - 1;
    if (isPunctuator(tokens[leftEnd], "?.")) leftEnd -= 1;
    const left = parseReceiverEndingAt(tokens, pairs, leftEnd);
    if (!left) return null;
    const propertyTokens = tokens.slice(openIndex + 1, endIndex);
    const literal = propertyTokens.length === 1
      && propertyTokens[0].type === "string"
      && !propertyTokens[0].escaped
      ? propertyTokens[0].value
      : null;
    return {
      base: left.base,
      properties: [...left.properties, literal],
      dynamicProperty: left.dynamicProperty || literal === null,
      tokenIndexes: [...left.tokenIndexes, openIndex, ...propertyTokens.map((_, offset) => openIndex + 1 + offset), endIndex],
    };
  }
  return null;
}

function isCreateRequireCallee(callee, loaderBindings) {
  const kind = loaderBindings.get(callee.base);
  return (kind === "createRequire" && callee.properties.length === 0)
    || (kind === "module-namespace"
      && callee.properties.length === 1
      && callee.properties[0] === "createRequire");
}

function loaderSpecifierForCallee(callee, createRequireAliases) {
  if (callee.base === "require" && callee.properties.length === 0) return "require";
  if (createRequireAliases.has(callee.base) && callee.properties.length === 0) return "create-require";
  return null;
}

function workerLoaderKind(callee, loaderBindings, tokens, openIndex) {
  const kind = loaderBindings.get(callee.base);
  const isNew = tokens[callee.tokenIndexes[0] - 1]?.type === "identifier"
    && tokens[callee.tokenIndexes[0] - 1].value === "new";
  if ((kind === "worker" && callee.properties.length === 0 && isNew)
    || (kind === "worker-namespace" && callee.properties.length === 1
      && callee.properties[0] === "Worker" && isNew)
    || (callee.base === "Worker" && callee.properties.length === 0 && isNew)) return "worker";
  if ((kind === "fork" && callee.properties.length === 0)
    || (kind === "child-process-namespace" && callee.properties.length === 1
      && callee.properties[0] === "fork")) return "fork";
  return null;
}

function childProcessExecutionMethod(callee, named, namespaces) {
  if (callee.properties.length === 0 && named.has(callee.base)) {
    return named.get(callee.base);
  }
  if (namespaces.has(callee.base)
    && callee.properties.length === 1
    && CHILD_PROCESS_EXECUTORS.has(callee.properties[0])) {
    return callee.properties[0];
  }
  return null;
}

function isFsOpenCallee(callee, fsNamed, fsNamespaces) {
  if (callee.properties.length === 0) return fsNamed.get(callee.base) === "open";
  return fsNamespaces.has(callee.base)
    && (callee.properties.join(".") === "open" || callee.properties.join(".") === "promises.open");
}

function requireImportMetaUrl(tokens, openIndex, closeIndex) {
  const values = tokens.slice(openIndex + 1, closeIndex).map((token) => token.value);
  if (values.length !== 5
    || values[0] !== "import"
    || values[1] !== "."
    || values[2] !== "meta"
    || values[3] !== "."
    || values[4] !== "url") reject();
}

function singlePlainStringArgument(tokens, openIndex, closeIndex) {
  if (closeIndex !== openIndex + 2) reject();
  return plainString(tokens[openIndex + 1]);
}

function literalFirstArgument(tokens, openIndex, closeIndex, allowTrailingArguments) {
  const first = tokens[openIndex + 1];
  if (!first || first.type !== "string" || first.escaped) reject();
  if (openIndex + 2 !== closeIndex
    && (!allowTrailingArguments || !isPunctuator(tokens[openIndex + 2], ","))) reject();
  return first.value;
}

function findImmediateCallOpen(tokens, startIndex) {
  let cursor = startIndex;
  if (tokens[cursor]?.type !== "identifier") return null;
  cursor += 1;
  while (cursor < tokens.length) {
    if (isPunctuator(tokens[cursor], "(")) return cursor;
    if (isPunctuator(tokens[cursor], ".") || isPunctuator(tokens[cursor], "?.")) {
      cursor += 2;
      continue;
    }
    if (isPunctuator(tokens[cursor], "[")) {
      cursor += 3;
      continue;
    }
    return null;
  }
  return null;
}

function parseSimpleMember(tokens, startIndex) {
  const operator = tokens[startIndex + 1];
  const property = tokens[startIndex + 2];
  if ((isPunctuator(operator, ".") || isPunctuator(operator, "?."))
    && property?.type === "identifier") return { property: property.value };
  if (isPunctuator(operator, "[") && property?.type === "string"
    && !property.escaped && isPunctuator(tokens[startIndex + 3], "]")) {
    return { property: property.value };
  }
  return null;
}

function isFunctionDeclarationCall(tokens, calleeIndex) {
  return tokens[calleeIndex - 1]?.type === "identifier"
    && tokens[calleeIndex - 1].value === "function";
}

function buildDelimiterPairs(tokens) {
  const forward = new Map();
  const reverse = new Map();
  const stack = [];
  const opens = new Map([["(", ")"], ["[", "]"], ["{", "}"], ["${", "}"]]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "punctuator") continue;
    if (opens.has(token.value)) stack.push({ index, close: opens.get(token.value) });
    else if ([")", "]", "}"].includes(token.value)) {
      const open = stack.pop();
      if (!open || open.close !== token.value) reject();
      forward.set(open.index, index);
      reverse.set(index, open.index);
    }
  }
  if (stack.length !== 0) reject();
  return { forward, reverse };
}

function tokenizeJavaScript(source) {
  const tokens = [];
  const parenthesisKinds = [];
  let index = 0;
  let line = 1;
  let column = 1;
  let braceDepth = 0;
  let bracketDepth = 0;

  function advance(count = 1) {
    for (let offset = 0; offset < count && index < source.length; offset += 1) {
      const character = source[index];
      if (character === "\r" && source[index + 1] === "\n") {
        index += 1;
        offset += 1;
        line += 1;
        column = 1;
      } else if (character === "\r" || character === "\n"
        || character === "\u2028" || character === "\u2029") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      index += 1;
    }
  }

  function emit(type, value, startLine, startColumn, extra = {}) {
    const token = Object.freeze({
      type,
      value,
      line: startLine,
      column: startColumn,
      braceDepth,
      bracketDepth,
      ...extra,
    });
    tokens.push(token);
    return token;
  }

  function scanCode(templateStopDepth = null) {
    while (index < source.length) {
      const character = source[index];
      if (/\s/u.test(character)) {
        advance();
        continue;
      }
      if (index === 0 && source.startsWith("#!", index)) {
        while (index < source.length && !/[\r\n\u2028\u2029]/u.test(source[index])) advance();
        continue;
      }
      if (source.startsWith("//", index)) {
        while (index < source.length && !/[\r\n\u2028\u2029]/u.test(source[index])) advance();
        continue;
      }
      if (source.startsWith("/*", index)) {
        advance(2);
        while (index < source.length && !source.startsWith("*/", index)) advance();
        if (index >= source.length) reject();
        advance(2);
        continue;
      }
      if (character === "'" || character === "\"") {
        emitString(character);
        continue;
      }
      if (character === "`") {
        scanTemplate();
        continue;
      }
      if (character === "}" && templateStopDepth !== null && braceDepth === templateStopDepth + 1) {
        const startLine = line;
        const startColumn = column;
        braceDepth -= 1;
        emit("punctuator", "}", startLine, startColumn, { closesTemplateExpression: true });
        advance();
        return;
      }
      if (character === "{") {
        emit("punctuator", "{", line, column);
        braceDepth += 1;
        advance();
        continue;
      }
      if (character === "}") {
        if (braceDepth === 0) reject();
        braceDepth -= 1;
        emit("punctuator", "}", line, column);
        advance();
        continue;
      }
      if (character === "[") {
        emit("punctuator", "[", line, column);
        bracketDepth += 1;
        advance();
        continue;
      }
      if (character === "]") {
        if (bracketDepth === 0) reject();
        bracketDepth -= 1;
        emit("punctuator", "]", line, column);
        advance();
        continue;
      }
      if (character === "/") {
        if (canStartRegularExpression(tokens.at(-1))) emitRegularExpression();
        else emitPunctuator();
        continue;
      }
      if (isIdentifierStart(character)) {
        const start = index;
        const startLine = line;
        const startColumn = column;
        advance();
        while (index < source.length && isIdentifierContinue(source[index])) advance();
        emit("identifier", source.slice(start, index), startLine, startColumn);
        continue;
      }
      if (/[0-9]/u.test(character)) {
        const start = index;
        const startLine = line;
        const startColumn = column;
        advance();
        while (index < source.length && /[0-9A-Za-z_.]/u.test(source[index])) advance();
        emit("number", source.slice(start, index), startLine, startColumn);
        continue;
      }
      const before = tokens.at(-1);
      const punctuator = emitPunctuator();
      if (punctuator.value === "(") {
        parenthesisKinds.push(before?.type === "identifier"
          && ["if", "while", "for", "with", "switch", "catch"].includes(before.value)
          ? "control"
          : "expression");
      } else if (punctuator.value === ")") {
        const kind = parenthesisKinds.pop();
        if (kind === undefined) reject();
        tokens[tokens.length - 1] = Object.freeze({ ...punctuator, closesControl: kind === "control" });
      }
    }
    if (templateStopDepth !== null) reject();
  }

  function emitString(quote) {
    const startLine = line;
    const startColumn = column;
    let value = "";
    let escaped = false;
    advance();
    while (index < source.length) {
      const character = source[index];
      if (character === quote) {
        advance();
        emit("string", value, startLine, startColumn, { escaped });
        return;
      }
      if (/[\r\n\u2028\u2029]/u.test(character)) reject();
      if (character === "\\") {
        escaped = true;
        advance();
        if (index >= source.length) reject();
        advance();
        continue;
      }
      value += character;
      advance();
    }
    reject();
  }

  function scanTemplate() {
    const startLine = line;
    const startColumn = column;
    emit("template", "`", startLine, startColumn);
    advance();
    while (index < source.length) {
      const character = source[index];
      if (character === "\\") {
        advance();
        if (index >= source.length) reject();
        advance();
        continue;
      }
      if (character === "`") {
        emit("template", "`", line, column);
        advance();
        return;
      }
      if (character === "$" && source[index + 1] === "{") {
        const expressionLine = line;
        const expressionColumn = column;
        advance(2);
        emit("punctuator", "${", expressionLine, expressionColumn);
        const stopDepth = braceDepth;
        braceDepth += 1;
        scanCode(stopDepth);
        continue;
      }
      advance();
    }
    reject();
  }

  function emitRegularExpression() {
    const start = index;
    const startLine = line;
    const startColumn = column;
    let inCharacterClass = false;
    advance();
    while (index < source.length) {
      const character = source[index];
      if (/[\r\n\u2028\u2029]/u.test(character)) reject();
      if (character === "\\") {
        advance();
        if (index >= source.length) reject();
        advance();
        continue;
      }
      if (character === "[") inCharacterClass = true;
      else if (character === "]") inCharacterClass = false;
      else if (character === "/" && !inCharacterClass) {
        advance();
        while (index < source.length && /[A-Za-z]/u.test(source[index])) advance();
        emit("regex", source.slice(start, index), startLine, startColumn);
        return;
      }
      advance();
    }
    reject();
  }

  function emitPunctuator() {
    const punctuators = [
      ">>>=", "&&=", "||=", "??=", "**=", "===", "!==", ">>>", "<<=", ">>=",
      "=>", "==", "!=", "<=", ">=", "++", "--", "&&", "||", "??", "?.", "**",
      "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "...",
    ];
    const value = punctuators.find((candidate) => source.startsWith(candidate, index)) ?? source[index];
    const startLine = line;
    const startColumn = column;
    advance(value.length);
    return emit("punctuator", value, startLine, startColumn);
  }

  scanCode();
  if (braceDepth !== 0 || bracketDepth !== 0 || parenthesisKinds.length !== 0) reject();
  return tokens;
}

function canStartRegularExpression(previous) {
  if (!previous || previous.closesControl === true) return true;
  if (previous.type === "identifier") {
    return [
      "await", "case", "delete", "do", "else", "extends", "in", "instanceof", "new",
      "return", "throw", "typeof", "void", "yield",
    ].includes(previous.value);
  }
  if (previous.type !== "punctuator") return false;
  return [
    "(", "[", "{", ",", ";", ":", "?", "=", "==", "===", "!=", "!==", "=>",
    "+", "-", "*", "/", "%", "**", "&", "|", "^", "!", "~", "&&", "||", "??",
    "<", ">", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
    "&&=", "||=", "??=", "${",
  ].includes(previous.value);
}

function findMatchingBrace(tokens, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (isPunctuator(tokens[index], "{")) depth += 1;
    else if (isPunctuator(tokens[index], "}")) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  reject();
}

function plainString(token) {
  if (!token || token.type !== "string" || token.escaped || token.value.length === 0) reject();
  return token.value;
}

function loaderRecord(kind, specifier, line) {
  return { kind, specifier, line };
}

function surface(file, line, kind, callee) {
  return { file: normalizePath(file), line, kind, callee };
}

function compareSurfaces(left, right) {
  const fileOrder = left.file.localeCompare(right.file);
  if (fileOrder !== 0) return fileOrder;
  if (left.line !== right.line) return left.line - right.line;
  const kindOrder = left.kind.localeCompare(right.kind);
  return kindOrder !== 0 ? kindOrder : left.callee.localeCompare(right.callee);
}

function deduplicate(records, keyFor) {
  return Array.from(new Map(records.map((record) => [keyFor(record), record])).values());
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function isPunctuator(token, value) {
  return token?.type === "punctuator" && token.value === value;
}

function isIdentifierStart(character) {
  return character === "$" || character === "_" || /\p{ID_Start}/u.test(character);
}

function isIdentifierContinue(character) {
  return character === "$" || character === "_" || character === "\u200C" || character === "\u200D"
    || /\p{ID_Continue}/u.test(character);
}

function reject() {
  throw new JavaScriptStaticAnalysisError();
}
