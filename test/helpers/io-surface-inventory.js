import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const SHELL_EXTENSIONS = new Set([".sh", ".bash", ".zsh"]);
const FS_WRITERS = new Set([
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "writeFile",
  "writeFileSync",
]);
const FS_READERS = new Set(["createReadStream", "lstat", "readFile", "readFileSync", "readdir", "realpath", "stat"]);
const FS_LIFECYCLE = new Set(["mkdir", "rename", "unlink"]);
const SOURCE_INTAKE_READERS = new Set(["readFile", "realpath", "stat"]);
const SOURCE_INTAKE_IO_METHODS = new Set(["lstat", "open", "realpath"]);
const PERSISTABILITY_WRITERS = new Set([
  "writePersistableJsonAtomic",
  "writePersistableProductTextAtomic",
  "writePersistableTextAtomic",
]);
const HANDLE_WRITERS = new Set(["appendFile", "createWriteStream", "write", "writeFile"]);
const HANDLE_READERS = new Set(["read", "readFile", "stat"]);
const HANDLE_LIFECYCLE = new Set(["truncate"]);
const STREAM_WRITERS = new Set(["end", "pipe"]);

export const IO_SURFACE_ALLOWLIST = buildExactAllowlist([
  ...classify("02", "gated", [
    "src/persistability.js:569:managed-writer:io.writeFile",
  ]),
  ...classify("03", "gated", [
    "src/discovery-db.js:200:managed-writer:persistability.writePersistableJsonAtomic",
    "src/discovery-db.js:201:managed-writer:persistability.writePersistableTextAtomic",
    "src/discovery-db.js:202:managed-writer:persistability.writePersistableJsonAtomic",
    "src/discovery-db.js:386:managed-writer:persistability.writePersistableJsonAtomic",
    "src/discovery-db.js:391:managed-writer:persistability.writePersistableTextAtomic",
    "src/discovery-source-workspace.js:240:managed-writer:persistability.writePersistableJsonAtomic",
    "src/discovery-source-workspace.js:241:managed-writer:persistability.writePersistableTextAtomic",
    "src/discovery-source-workspace.js:242:managed-writer:persistability.writePersistableJsonAtomic",
    "src/discovery-source-workspace.js:243:managed-writer:persistability.writePersistableJsonAtomic",
    "src/discovery-source-workspace.js:244:managed-writer:persistability.writePersistableTextAtomic",
  ]),
  ...classify("03", "non-artifact-intake", [
    "src/discovery-source-workspace.js:278:non-artifact-intake:sourceIntakeIo.realpath",
    "src/discovery-source-workspace.js:283:non-artifact-intake:sourceIntakeIo.realpath",
    "src/discovery-source-workspace.js:290:non-artifact-intake:sourceIntakeIo.lstat",
    "src/discovery-source-workspace.js:291:non-artifact-intake:sourceIntakeIo.lstat",
    "src/discovery-source-workspace.js:374:non-artifact-intake:sourceIntakeIo.realpath",
    "src/discovery-source-workspace.js:397:non-artifact-intake:sourceIntakeIo.lstat",
    "src/discovery-source-workspace.js:509:non-artifact-intake:sourceIntakeIo.open",
    "src/discovery-source-workspace.js:510:file-handle-read:FileHandle.stat",
    "src/discovery-source-workspace.js:527:file-handle-read:FileHandle.stat",
    "src/discovery-source-workspace.js:562:non-artifact-intake:sourceIntakeIo.lstat",
    "src/discovery-source-workspace.js:563:non-artifact-intake:sourceIntakeIo.realpath",
    "src/discovery-source-workspace.js:564:non-artifact-intake:sourceIntakeIo.lstat",
    "src/discovery-source-workspace.js:565:non-artifact-intake:sourceIntakeIo.realpath",
    "src/discovery-source-workspace.js:566:non-artifact-intake:sourceIntakeIo.lstat",
    "src/discovery-source-workspace.js:567:non-artifact-intake:sourceIntakeIo.realpath",
    "src/discovery-source-workspace.js:595:file-handle-read:FileHandle.read",
  ]),
  ...classify("04", "gated", [
    "src/blueprint-draft.js:154:managed-writer:persistability.writePersistableJsonAtomic",
    "src/design-plan.js:198:managed-writer:persistability.writePersistableJsonAtomic",
  ]),
  ...classify("05", "gated", [
    "src/migration-filesystem.js:801:managed-writer:faultController.write",
    "src/migration-filesystem.js:854:file-handle:FileHandle.write",
  ]),
  ...classify("06", "gated", [
    "src/handoff.js:131:managed-writer:persistability.writePersistableTextAtomic",
  ]),
  ...classify("07", "gated", [
    "src/build-state.js:179:managed-operation:operation:write-file",
    "src/scaffold.js:44:managed-writer:persistability.writePersistableProductTextAtomic",
    "src/scaffold.js:52:managed-writer:persistability.writePersistableTextAtomic",
    "src/scaffold.js:73:managed-operation:operation:write-file",
    "src/targets/operations.js:8:managed-operation:operation:write-file",
  ]),
  ...classify("08", "gated", [
    "src/run-state.js:152:filesystem-lifecycle:fs.mkdir",
    "src/run-state.js:156:filesystem-open:fs.open",
    "src/run-state.js:182:managed-writer:persistability.writePersistableJsonAtomic",
    "src/run-state.js:183:managed-writer:persistability.writePersistableJsonAtomic",
    "src/run-state.js:189:filesystem-lifecycle:fs.unlink",
    "src/run-state.js:978:filesystem-read:fs.stat",
  ]),
  ...classify("09", "gated", [
    "src/run-observation.js:79:managed-writer:persistability.writePersistableJsonAtomic",
  ]),
  ...classify("11", "gated", [
    "src/cli.js:936:process-output:process.stdout.write",
  ]),
  ...classify("11", "non-artifact", [
    "src/cli.js:940:process-output:process.stdout.write",
  ]),
  ...classify("11", "diagnostic", [
    "src/cli.js:944:process-output:process.stdout.write",
    "src/cli.js:948:process-output:process.stderr.write",
  ]),
  ...classify("12", "gated", [
    "scripts/openclaw-live-smoke.sh:304:shell-redirection:shell.redirect",
    "scripts/openclaw-live-smoke.sh:315:shell-redirection:shell.redirect",
    "scripts/openclaw-live-smoke.sh:320:shell-redirection:shell.redirect",
    "scripts/openclaw-live-smoke.sh:321:shell-redirection:shell.redirect",
    "scripts/openclaw-live-smoke.sh:322:shell-redirection:shell.redirect",
  ]),
  ...classify("12", "non-artifact", [
    "scripts/openclaw-live-smoke.sh:5:shell-output:shell.cat",
    "scripts/openclaw-live-smoke.sh:99:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:99:shell-redirection:shell.redirect",
    "scripts/openclaw-live-smoke.sh:100:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:100:shell-redirection:shell.redirect",
    "scripts/openclaw-live-smoke.sh:182:shell-output:shell.node-fd1",
    "scripts/openclaw-live-smoke.sh:221:shell-redirection:shell.redirect",
  ]),
  ...classify("12", "non-artifact-intake", [
    "scripts/openclaw-live-smoke.sh:182:shell-exact-byte-read:fs.readFileSync",
  ]),
  ...classify("12", "diagnostic", [
    "scripts/openclaw-live-smoke.sh:90:shell-output:shell.echo",
    "scripts/openclaw-live-smoke.sh:90:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:91:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:121:shell-output:shell.echo",
    "scripts/openclaw-live-smoke.sh:121:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:122:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:127:shell-output:shell.echo",
    "scripts/openclaw-live-smoke.sh:127:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:132:shell-output:shell.echo",
    "scripts/openclaw-live-smoke.sh:132:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:136:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:136:shell-redirection:shell.redirect",
    "scripts/openclaw-live-smoke.sh:137:shell-output:shell.printf",
    "scripts/openclaw-live-smoke.sh:137:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:146:shell-output:shell.echo",
    "scripts/openclaw-live-smoke.sh:146:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:187:shell-output:shell.echo",
    "scripts/openclaw-live-smoke.sh:187:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:199:shell-output:shell.echo",
    "scripts/openclaw-live-smoke.sh:199:shell-redirection:shell.fd-redirect",
  ]),
  ...classify("12", "ephemeral-secret", [
    "scripts/openclaw-live-smoke.sh:174:shell-output:shell.printf",
    "scripts/openclaw-live-smoke.sh:177:shell-input:shell.redirect-input",
    "scripts/openclaw-live-smoke.sh:260:process-output:process.stdout.write",
    "scripts/openclaw-live-smoke.sh:266:shell-output:shell.printf",
    "scripts/openclaw-live-smoke.sh:267:shell-output:shell.printf",
    "scripts/openclaw-live-smoke.sh:268:shell-output:shell.printf",
    "scripts/openclaw-live-smoke.sh:269:shell-output:shell.printf",
    "scripts/openclaw-live-smoke.sh:270:shell-output:shell.printf",
    "scripts/openclaw-live-smoke.sh:271:shell-redirection:shell.redirect",
  ]),
  ...classify("12", "transient-runtime", [
    "scripts/openclaw-live-smoke.sh:251:shell-redirection:shell.redirect",
    "scripts/openclaw-live-smoke.sh:273:shell-redirection:shell.fd-redirect",
    "scripts/openclaw-live-smoke.sh:273:shell-redirection:shell.redirect",
  ]),
  ...classifyPhase("01.2", "05", "diagnostic", [
    "scripts/node20-core-lane.sh:5:shell-input:shell.redirect-input",
    "scripts/node20-core-lane.sh:5:shell-output:shell.printf",
    "scripts/node20-core-lane.sh:5:shell-redirection:shell.redirect",
    "scripts/node20-core-lane.sh:9:shell-output:shell.printf",
    "scripts/node20-core-lane.sh:9:shell-redirection:shell.fd-redirect",
    "scripts/node20-core-lane.sh:10:shell-redirection:shell.fd-redirect",
    "scripts/node20-core-lane.sh:67:shell-output:shell.printf",
    "scripts/node20-core-lane.sh:67:shell-redirection:shell.fd-redirect",
    "scripts/node20-core-lane.sh:76:shell-output:shell.printf",
    "scripts/node20-core-lane.sh:76:shell-redirection:shell.fd-redirect",
    "scripts/node20-core-lane.sh:93:shell-output:shell.printf",
    "scripts/node20-core-lane.sh:93:shell-redirection:shell.fd-redirect",
  ]),
  ...classifyPhase("01.2", "11", "diagnostic", [
    "scripts/node20-core-receipt.js:810:process-output:process.stderr.write",
  ]),
  ...classifyPhase("01.2", "11", "non-artifact-intake", [
    "scripts/node20-core-receipt.js:124:filesystem-read:fs.realpath",
    "scripts/node20-core-receipt.js:125:filesystem-read:fs.realpath",
    "scripts/node20-core-receipt.js:126:filesystem-read:fs.stat",
    "scripts/node20-core-receipt.js:147:filesystem-read:fs.readFile",
    "scripts/node20-core-receipt.js:180:filesystem-read:fs.readFile",
    "scripts/node20-core-receipt.js:273:filesystem-read:fs.readFile",
    "scripts/node20-core-receipt.js:462:filesystem-read:fs.createReadStream",
    "scripts/node20-core-receipt.js:563:filesystem-read:fs.stat",
    "scripts/node20-core-receipt.js:573:filesystem-read:fs.createReadStream",
    "scripts/node20-core-receipt.js:585:filesystem-read:fs.lstat",
    "scripts/node20-core-receipt.js:789:filesystem-read:fs.realpath",
    "scripts/node20-core-receipt.js:790:filesystem-read:fs.realpath",
  ]),
  ...classifyPhase("01.2", "11", "gated", [
    "scripts/node20-core-receipt.js:351:managed-writer:persistability.writePersistableJsonAtomic",
  ]),
  ...classifyPhase("01.2", "11", "non-artifact", [
    "scripts/node20-core-receipt.js:354:process-output:process.stdout.write",
  ]),
  ...classify("13", "gated", [
    "scripts/live-smoke-summary.js:93:managed-writer:persistability.writePersistableJsonAtomic",
    "scripts/live-smoke-summary.js:98:serializer-to-sink:emitPersistableOutput",
    "scripts/live-smoke-summary.js:237:process-output:process.stdout.write",
    "src/artifact-admission.js:310:filesystem-open:file.openInput",
    "src/artifact-admission.js:311:file-handle-read:FileHandle.stat",
    "src/artifact-admission.js:321:file-handle-read:FileHandle.read",
    "src/artifact-admission.js:333:file-handle-read:FileHandle.stat",
    "src/artifact-subjects.js:25:filesystem-read:fs.readFileSync",
    "src/blueprint.js:117:durable-loader:loadAdmittedArtifact",
    "src/cli.js:145:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:170:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:175:durable-loader:loadAdmittedArtifact",
    "src/cli.js:258:durable-loader:loadAdmittedArtifact",
    "src/cli.js:263:durable-loader:loadAdmittedArtifact",
    "src/cli.js:289:durable-loader:loadAdmittedArtifact",
    "src/cli.js:294:durable-loader:loadAdmittedArtifact",
    "src/cli.js:300:durable-loader:loadAdmittedArtifact",
    "src/cli.js:329:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:354:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:385:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:397:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:413:durable-loader:loadAdmittedArtifact",
    "src/cli.js:487:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:491:durable-loader:loadAdmittedArtifact",
    "src/cli.js:496:durable-loader:loadAdmittedArtifact",
    "src/cli.js:501:durable-loader:loadAdmittedArtifact",
    "src/cli.js:526:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:530:durable-loader:loadAdmittedArtifact",
    "src/cli.js:549:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:553:durable-loader:loadAdmittedArtifact",
    "src/cli.js:558:durable-loader:loadAdmittedArtifact",
    "src/cli.js:563:durable-loader:loadAdmittedArtifact",
    "src/cli.js:569:durable-loader:loadAdmittedArtifact",
    "src/cli.js:581:durable-loader:loadAdmittedArtifact",
    "src/cli.js:630:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:833:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:845:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:858:serializer-to-sink:emitPersistableOutput",
    "src/control-snapshot.js:19:durable-loader:loadAdmittedArtifact",
    "src/design-plan.js:51:durable-loader:loadAdmittedArtifact",
    "src/discovery-db.js:34:durable-loader:loadAdmittedArtifact",
    "src/discovery.js:19:durable-loader:loadAdmittedArtifact",
    "src/domain-eval.js:33:durable-loader:loadAdmittedArtifact",
    "src/handoff.js:60:durable-loader:loadAdmittedArtifact",
    "src/migration-filesystem.js:224:filesystem-lifecycle:fs.mkdir",
    "src/migration-filesystem.js:235:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:238:filesystem-open:fs.open",
    "src/migration-filesystem.js:369:filesystem-open:fs.open",
    "src/migration-filesystem.js:370:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:420:filesystem-read:fs.readdir",
    "src/migration-filesystem.js:452:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:460:filesystem-open:fs.open",
    "src/migration-filesystem.js:461:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:462:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:477:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:530:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:531:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:554:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:555:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:589:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:593:filesystem-open:fs.open",
    "src/migration-filesystem.js:594:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:595:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:617:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:619:filesystem-open:fs.open",
    "src/migration-filesystem.js:620:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:630:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:714:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:729:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:734:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:736:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:773:filesystem-open:fs.open",
    "src/migration-filesystem.js:836:filesystem-open:fs.open",
    "src/migration-filesystem.js:851:file-handle-lifecycle:FileHandle.truncate",
    "src/migration-filesystem.js:865:file-handle-lifecycle:FileHandle.truncate",
    "src/migration-filesystem.js:874:file-handle-lifecycle:FileHandle.truncate",
    "src/migration-filesystem.js:888:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:889:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:937:filesystem-open:fs.open",
    "src/migration-filesystem.js:952:file-handle-read:FileHandle.read",
    "src/migration-filesystem.js:1148:filesystem-read:fs.lstat",
    "src/observation.js:18:durable-loader:loadAdmittedArtifact",
    "src/persistability.js:198:serializer-to-sink:sink",
    "src/persistability.js:568:managed-filesystem:io.mkdir",
    "src/persistability.js:570:managed-filesystem:io.rename",
    "src/run-state.js:200:durable-loader:loadAdmittedArtifact",
    "src/run-state.js:213:durable-loader:loadAdmittedArtifact",
    "src/scaffold.js:139:filesystem-read:fs.readdir",
    "src/scaffold.js:155:filesystem-read:fs.lstat",
    "src/user-need.js:12:durable-loader:loadAdmittedArtifact",
  ]),
  ...classify("13", "non-artifact", [
    "scripts/openclaw-live-smoke.sh:5:shell-input:shell.heredoc",
  ]),
  ...classify("13", "non-artifact-intake", [
    "scripts/openclaw-live-smoke.sh:182:filesystem-read:fs.readFileSync",
  ]),
  ...classifyPhase("01.2", "06", "ephemeral-secret", [
    "src/cli.js:1839:filesystem-read:fs.readFile",
  ]),
  ...classifyPhase("01.2", "06", "transient-runtime", [
    "src/cli.js:1813:filesystem-read:fs.readFile",
  ]),
]);

export async function inventoryIoSurfaces(repoRoot) {
  const roots = ["src", "bin", "scripts"];
  const files = [];
  for (const root of roots) {
    const absoluteRoot = path.join(repoRoot, root);
    for (const file of await walkFiles(absoluteRoot)) files.push(file);
  }
  const surfaces = [];
  for (const file of files.sort()) {
    const relativePath = normalizePath(path.relative(repoRoot, file));
    const source = await readFile(file, "utf8");
    if (SHELL_EXTENSIONS.has(path.extname(file))) {
      surfaces.push(...inventoryShellSource(source, relativePath));
      surfaces.push(...inventoryJavaScriptSource(source, relativePath));
    } else if (JS_EXTENSIONS.has(path.extname(file))) {
      surfaces.push(...inventoryJavaScriptSource(source, relativePath));
    }
  }
  return surfaces.sort(compareSurfaces);
}

export const scanIoSurfaces = inventoryIoSurfaces;

export function inventoryJavaScriptSource(source, file = "fixture.js") {
  const aliases = collectFsAliases(source);
  const persistabilityAliases = collectPersistabilityAliases(source);
  const handleNames = collectFileHandleNames(source, aliases);
  const processOutputAliases = collectProcessOutputAliases(source);
  const consoleAliases = collectConsoleAliases(source);
  const namespaceNames = aliases.namespaces;
  const surfaces = [];
  const lines = source.split(/\r?\n/u);

  for (const [zeroIndex, line] of lines.entries()) {
    const lineNumber = zeroIndex + 1;
    const withoutLineComment = line.replace(/\/\/.*$/u, "");
    if (withoutLineComment.trim().length === 0 || /^\s*import\b/u.test(withoutLineComment)) continue;

    for (const [localName, originalName] of aliases.named.entries()) {
      if (!new RegExp(`(^|[^\\w$.])${escapeRegExp(localName)}\\s*\\(`, "u").test(withoutLineComment)) continue;
      if (SOURCE_INTAKE_READERS.has(originalName) && localName.startsWith("sourceIntake")) {
        surfaces.push(surface(file, lineNumber, "non-artifact-intake", `fs.${originalName}`));
      } else if (FS_READERS.has(originalName)) {
        surfaces.push(surface(file, lineNumber, "filesystem-read", `fs.${originalName}`));
      } else if (originalName === "open") {
        surfaces.push(surface(file, lineNumber, "filesystem-open", "fs.open"));
      } else if (FS_LIFECYCLE.has(originalName)) {
        surfaces.push(surface(file, lineNumber, "filesystem-lifecycle", `fs.${originalName}`));
      } else if (FS_WRITERS.has(originalName)) {
        surfaces.push(surface(file, lineNumber, "filesystem", `fs.${originalName}`));
      } else if (originalName !== "constants") {
        surfaces.push(surface(file, lineNumber, "unclassified", `fs.${originalName}`));
      }
    }
    for (const [localName, originalName] of persistabilityAliases.entries()) {
      if (!PERSISTABILITY_WRITERS.has(originalName)) continue;
      if (new RegExp(`(^|[^\\w$.])${escapeRegExp(localName)}\\s*\\(`, "u").test(withoutLineComment)) {
        surfaces.push(surface(file, lineNumber, "managed-writer", `persistability.${originalName}`));
      }
    }
    for (const namespaceName of namespaceNames) {
      for (const [methods, kind] of [
        [FS_WRITERS, "filesystem"],
        [FS_READERS, "filesystem-read"],
        [FS_LIFECYCLE, "filesystem-lifecycle"],
        [new Set(["open"]), "filesystem-open"],
      ]) {
        for (const method of methods) {
          const direct = new RegExp(`\\b${escapeRegExp(namespaceName)}\\s*\\.\\s*${method}\\s*\\(`, "u");
          const promises = new RegExp(`\\b${escapeRegExp(namespaceName)}\\s*\\.\\s*promises\\s*\\.\\s*${method}\\s*\\(`, "u");
          if (direct.test(withoutLineComment) || promises.test(withoutLineComment)) {
            surfaces.push(surface(file, lineNumber, kind, `fs.${method}`));
          }
        }
      }
    }
    if (/\bopenInput\s*\(/u.test(withoutLineComment)) {
      surfaces.push(surface(file, lineNumber, "filesystem-open", "file.openInput"));
    }
    for (const method of SOURCE_INTAKE_IO_METHODS) {
      if (new RegExp(`\\bsourceIntakeIo\\s*\\.\\s*${method}\\s*\\(`, "u").test(withoutLineComment)) {
        surfaces.push(surface(file, lineNumber, "non-artifact-intake", `sourceIntakeIo.${method}`));
      }
    }
    for (const handleName of handleNames) {
      for (const writer of HANDLE_WRITERS) {
        if (new RegExp(`\\b${escapeRegExp(handleName)}\\s*\\.\\s*${writer}\\s*\\(`, "u").test(withoutLineComment)) {
          surfaces.push(surface(file, lineNumber, "file-handle", `FileHandle.${writer}`));
        }
      }
      for (const reader of HANDLE_READERS) {
        if (new RegExp(`\\b${escapeRegExp(handleName)}\\s*\\.\\s*${reader}\\s*\\(`, "u").test(withoutLineComment)) {
          surfaces.push(surface(file, lineNumber, "file-handle-read", `FileHandle.${reader}`));
        }
      }
      for (const method of HANDLE_LIFECYCLE) {
        if (new RegExp(`\\b${escapeRegExp(handleName)}\\s*\\.\\s*${method}\\s*\\(`, "u").test(withoutLineComment)) {
          surfaces.push(surface(file, lineNumber, "file-handle-lifecycle", `FileHandle.${method}`));
        }
      }
    }
    for (const writer of HANDLE_WRITERS) {
      const memberCall = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*\\.\\s*${writer}\\s*\\(`, "gu");
      for (const match of withoutLineComment.matchAll(memberCall)) {
        const receiver = match[1];
        if (namespaceNames.has(receiver) || ["process", "stdout", "stderr"].includes(receiver) || handleNames.has(receiver)) continue;
        if (processOutputAliases.has(receiver)) continue;
        if (receiver === "console") continue;
        surfaces.push(surface(file, lineNumber, "managed-writer", `${receiver}.${writer}`));
      }
    }
    for (const method of FS_LIFECYCLE) {
      const memberCall = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*\\.\\s*${method}\\s*\\(`, "gu");
      for (const match of withoutLineComment.matchAll(memberCall)) {
        const receiver = match[1];
        if (namespaceNames.has(receiver) || handleNames.has(receiver)) continue;
        surfaces.push(surface(file, lineNumber, "managed-filesystem", `${receiver}.${method}`));
      }
    }
    for (const method of STREAM_WRITERS) {
      const memberCall = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*\\.\\s*${method}\\s*\\(`, "gu");
      for (const match of withoutLineComment.matchAll(memberCall)) {
        const receiver = match[1];
        if (handleNames.has(receiver)) continue;
        surfaces.push(surface(file, lineNumber, "stream-write", `${receiver}.${method}`));
      }
    }
    for (const match of withoutLineComment.matchAll(/\b(loadAdmitted[A-Za-z0-9_$]*)\s*\(/gu)) {
      const callee = match[1];
      if (!new RegExp(`\\bfunction\\s+${escapeRegExp(callee)}\\s*\\(`, "u").test(withoutLineComment)) {
        surfaces.push(surface(file, lineNumber, "durable-loader", callee));
      }
    }
    if (/\bemitPersistableOutput\s*\(/u.test(withoutLineComment)
      && !/\bfunction\s+emitPersistableOutput\s*\(/u.test(withoutLineComment)) {
      surfaces.push(surface(file, lineNumber, "serializer-to-sink", "emitPersistableOutput"));
    }
    if (/\bsink\s*\(\s*formatted\s*\)/u.test(withoutLineComment)) {
      surfaces.push(surface(file, lineNumber, "serializer-to-sink", "sink"));
    }
    for (const channel of ["stdout", "stderr"]) {
      if (new RegExp(`\\bprocess\\s*\\.\\s*${channel}\\s*\\.\\s*write\\s*\\(`, "u").test(withoutLineComment)) {
        surfaces.push(surface(file, lineNumber, "process-output", `process.${channel}.write`));
      }
      if (new RegExp(`\\bprocess\\s*\\[\\s*["']${channel}["']\\s*\\]\\s*\\.\\s*write\\s*\\(`, "u").test(withoutLineComment)) {
        surfaces.push(surface(file, lineNumber, "process-output", `process.${channel}.write`));
      }
    }
    for (const [alias, channel] of processOutputAliases) {
      if (new RegExp(`\\b${escapeRegExp(alias)}\\s*\\.\\s*write\\s*\\(`, "u").test(withoutLineComment)) {
        surfaces.push(surface(file, lineNumber, "process-output", `process.${channel}.write`));
      }
    }
    for (const method of ["log", "error", "warn", "info", "debug"]) {
      if (new RegExp(`\\bconsole\\s*\\.\\s*${method}\\s*\\(`, "u").test(withoutLineComment)) {
        surfaces.push(surface(file, lineNumber, "console-output", `console.${method}`));
      }
    }
    for (const alias of consoleAliases) {
      for (const method of ["log", "error", "warn", "info", "debug"]) {
        if (new RegExp(`\\b${escapeRegExp(alias)}\\s*\\.\\s*${method}\\s*\\(`, "u").test(withoutLineComment)) {
          surfaces.push(surface(file, lineNumber, "console-output", `console.${method}`));
        }
      }
    }
    if (/\b(?:type|kind)\s*(?::|={2,3}|!={1,2})\s*["']write-file["']/u.test(withoutLineComment)) {
      surfaces.push(surface(file, lineNumber, "managed-operation", "operation:write-file"));
    }
  }
  return deduplicateSurfaces(surfaces);
}

export function inventoryShellSource(source, file = "fixture.sh") {
  const surfaces = [];
  for (const [zeroIndex, line] of source.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const lineNumber = zeroIndex + 1;
    if (/(^|[^>])>>?\s*(?![&>])/u.test(line)) {
      surfaces.push(surface(file, lineNumber, "shell-redirection", "shell.redirect"));
    }
    if (/(^|[|;]\s*)tee(?:\s|$)/u.test(line)) {
      surfaces.push(surface(file, lineNumber, "shell-redirection", "shell.tee"));
    }
    if (/(?:^|[\s;])(?:[0-9]+)?(?:>&|<&)(?:[0-9]+|-)/u.test(line)) {
      surfaces.push(surface(file, lineNumber, "shell-redirection", "shell.fd-redirect"));
    }
    if (/(^|[^<])<\s*(?!<)/u.test(line)) {
      surfaces.push(surface(file, lineNumber, "shell-input", "shell.redirect-input"));
    }
    if (/<<-?\s*(?:["']?[A-Za-z_][A-Za-z0-9_]*["']?)/u.test(line)) {
      surfaces.push(surface(file, lineNumber, "shell-input", "shell.heredoc"));
    }
    if (/\breadFileSync\s*\(\s*process\.argv\[1\]\s*\)/u.test(line)) {
      surfaces.push(surface(file, lineNumber, "shell-exact-byte-read", "fs.readFileSync"));
    }
    if (/\bfs\.writeSync\s*\(\s*1\s*,/u.test(line)) {
      surfaces.push(surface(file, lineNumber, "shell-output", "shell.node-fd1"));
    }
    for (const command of ["cat", "echo", "printf"]) {
      if (new RegExp(`\\b${command}\\b`, "u").test(line)) {
        surfaces.push(surface(file, lineNumber, "shell-output", `shell.${command}`));
      }
    }
    if (/\bcat\s+(?!<<-?)(?:"[^"\n]+"|'[^'\n]+'|\$\{?[A-Za-z_]|[./])/u.test(line)) {
      surfaces.push(surface(file, lineNumber, "shell-file-read", "shell.cat"));
    }
  }
  return deduplicateSurfaces(surfaces);
}

export function surfaceId(item) {
  return `${item.file}:${item.line}:${item.kind}:${item.callee}`;
}

async function walkFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(child)));
    else if (JS_EXTENSIONS.has(path.extname(entry.name)) || SHELL_EXTENSIONS.has(path.extname(entry.name))) files.push(child);
  }
  return files;
}

function collectFsAliases(source) {
  const named = new Map();
  const namespaces = new Set();
  const namedImport = /import\s*\{([^}]*)\}\s*from\s*["']node:fs(?:\/promises)?["']/gu;
  for (const match of source.matchAll(namedImport)) {
    for (const specifier of match[1].split(",")) {
      const parts = specifier.trim().split(/\s+as\s+/u);
      if (parts[0]) named.set(parts[1] ?? parts[0], parts[0]);
    }
  }
  const namespaceImport = /import\s+(?:\*\s+as\s+|)([A-Za-z_$][\w$]*)\s+from\s*["']node:fs(?:\/promises)?["']/gu;
  for (const match of source.matchAll(namespaceImport)) namespaces.add(match[1]);
  const requireNamespace = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*["']node:fs(?:\/promises)?["']\s*\)/gu;
  for (const match of source.matchAll(requireNamespace)) namespaces.add(match[1]);
  const requireNamed = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*["']node:fs(?:\/promises)?["']\s*\)/gu;
  for (const match of source.matchAll(requireNamed)) {
    for (const specifier of match[1].split(",")) {
      const [original, local] = specifier.trim().split(/\s*:\s*/u);
      if (original) named.set(local ?? original, original);
    }
  }
  return { named, namespaces };
}

function collectPersistabilityAliases(source) {
  const named = new Map();
  const pattern = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*persistability\.js["']/gu;
  for (const match of source.matchAll(pattern)) {
    for (const specifier of match[1].split(",")) {
      const parts = specifier.trim().split(/\s+as\s+/u);
      if (parts[0]) named.set(parts[1] ?? parts[0], parts[0]);
    }
  }
  return named;
}

function collectFileHandleNames(source, aliases) {
  const openNames = new Set();
  for (const [localName, originalName] of aliases.named.entries()) {
    if (originalName === "open") openNames.add(localName);
  }
  for (const namespaceName of aliases.namespaces) openNames.add(`${namespaceName}.open`);
  const handles = new Set();
  for (const openName of openNames) {
    const pattern = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?${escapeRegExp(openName)}\\s*\\(`, "gu");
    for (const match of source.matchAll(pattern)) handles.add(match[1]);
  }
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?openInput\s*\(/gu)) {
    handles.add(match[1]);
  }
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*[Hh]andle)\s*\.\s*(?:read|readFile|stat|truncate|write|writeFile)\s*\(/gu)) {
    handles.add(match[1]);
  }
  if (/\bhandle\s*\.\s*(?:read|readFile|stat|truncate|write|writeFile)\s*\(/u.test(source)) handles.add("handle");
  return handles;
}

function collectProcessOutputAliases(source) {
  const aliases = new Map();
  const pattern = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*process(?:\s*\.\s*(stdout|stderr)|\s*\[\s*["'](stdout|stderr)["']\s*\])/gu;
  for (const match of source.matchAll(pattern)) aliases.set(match[1], match[2] ?? match[3]);
  return aliases;
}

function collectConsoleAliases(source) {
  const aliases = new Set();
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*console\b/gu)) aliases.add(match[1]);
  return aliases;
}

function surface(file, line, kind, callee) {
  return { file: normalizePath(file), line, kind, callee };
}

function deduplicateSurfaces(surfaces) {
  return Array.from(new Map(surfaces.map((item) => [surfaceId(item), item])).values()).sort(compareSurfaces);
}

function compareSurfaces(left, right) {
  const fileOrder = left.file.localeCompare(right.file);
  if (fileOrder !== 0) return fileOrder;
  if (left.line !== right.line) return left.line - right.line;
  const kindOrder = left.kind.localeCompare(right.kind);
  return kindOrder !== 0 ? kindOrder : left.callee.localeCompare(right.callee);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function classify(plan, status, ids) {
  return classifyPhase("01.1", plan, status, ids);
}

function classifyPhase(phase, plan, status, ids) {
  return ids.map((id) => [id, { owner: `phase-${phase}-plan-${plan}`, status }]);
}

function buildExactAllowlist(rows) {
  const allowlist = new Map();
  for (const [id, classification] of rows) {
    if (allowlist.has(id)) throw new Error("Duplicate I/O surface allowlist row.");
    allowlist.set(id, Object.freeze({ ...classification }));
  }
  return allowlist;
}
