import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeJavaScriptSource } from "../../src/javascript-static-analysis.js";

const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const SHELL_EXTENSIONS = new Set([".sh", ".bash", ".zsh"]);
const FS_WRITERS = new Set([
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "writeFile",
  "writeFileSync",
]);
const FS_READERS = new Set([
  "createReadStream",
  "lstat",
  "opendir",
  "readFile",
  "readFileSync",
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

export const IO_SURFACE_ALLOWLIST = buildExactAllowlist([
  ...classify("02", "gated", [
    "src/persistability.js:639:managed-writer:io.writeFile",
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
    "src/blueprint-draft.js:165:managed-writer:persistability.writePersistableJsonAtomic",
    "src/design-plan.js:201:managed-writer:persistability.writePersistableJsonAtomic",
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
  ...classifyPhase("02", "02", "gated", [
    "src/builder-events.js:406:filesystem-open:file.openInput",
    "src/builder-events.js:407:file-handle-read:FileHandle.stat",
    "src/builder-events.js:412:file-handle-read:FileHandle.read",
    "src/builder-events.js:416:file-handle-read:FileHandle.stat",
  ]),
  ...classifyPhase("02", "11", "gated", [
    "src/builder-immutable-journal.js:42:filesystem-lifecycle:fs.mkdir",
    "src/builder-immutable-journal.js:88:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:107:filesystem-lifecycle:fs.link",
    "src/builder-immutable-journal.js:129:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:190:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:281:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:283:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:287:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:288:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:292:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:308:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:309:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:321:filesystem-read:fs.readdir",
    "src/builder-immutable-journal.js:480:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:498:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:504:file-handle-read:FileHandle.read",
    "src/builder-immutable-journal.js:522:file-handle:FileHandle.write",
    "src/builder-immutable-journal.js:530:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:531:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:547:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:557:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:560:filesystem-lifecycle:fs.unlink",
  ]),
  ...classifyPhase("02", "12", "gated", [
  ]),
  ...classifyPhase("02", "13", "gated", [
    "src/builder-codex-host.js:147:filesystem-lifecycle:fs.rename",
    "src/builder-codex-host.js:177:filesystem-lifecycle:fs.rename",
    "src/builder-codex-host.js:401:filesystem-lifecycle:fs.rename",
    "src/builder-codex-host.js:409:filesystem-lifecycle:fs.rename",
    "src/builder-codex-host.js:410:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:552:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-host.js:561:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:578:filesystem-open:fs.open",
    "src/builder-codex-host.js:583:file-handle:FileHandle.writeFile",
    "src/builder-codex-host.js:584:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-host.js:590:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:624:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:647:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:648:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:758:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-host.js:760:filesystem-lifecycle:fs.rename",
    "src/builder-codex-host.js:767:filesystem-lifecycle:fs.rename",
    "src/builder-codex-host.js:810:filesystem-lifecycle:fs.rmdir",
    "src/builder-codex-host.js:830:filesystem-lifecycle:fs.link",
    "src/builder-codex-host.js:831:filesystem-lifecycle:fs.unlink",
    "src/builder-codex-host.js:882:stream-write:stdin.end",
    "src/builder-codex-host.js:914:managed-writer:stdin.write",
    "src/builder-codex-host.js:940:managed-writer:stdin.write",
    "src/builder-codex-host.js:1093:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1094:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1098:filesystem-read:fs.realpath",
    "src/builder-codex-host.js:1099:filesystem-read:fs.realpath",
    "src/builder-codex-host.js:1109:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1117:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:1123:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1131:filesystem-open:fs.open",
    "src/builder-codex-host.js:1133:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1134:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:1135:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1136:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1155:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1278:filesystem-open:fs.open",
    "src/builder-codex-host.js:1279:file-handle:FileHandle.writeFile",
    "src/builder-codex-host.js:1280:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-host.js:1284:filesystem-lifecycle:fs.link",
    "src/builder-codex-host.js:1285:filesystem-lifecycle:fs.unlink",
    "src/builder-codex-host.js:1287:filesystem-lifecycle:fs.rename",
    "src/builder-codex-host.js:1295:filesystem-lifecycle:fs.link",
    "src/builder-codex-host.js:1296:filesystem-lifecycle:fs.unlink",
    "src/builder-codex-host.js:1304:filesystem-lifecycle:fs.unlink",
    "src/builder-codex-host.js:1327:filesystem-lifecycle:fs.unlink",
    "src/builder-codex-host.js:1354:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1359:filesystem-open:fs.open",
    "src/builder-codex-host.js:1360:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1361:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:1362:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1363:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1429:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-host.js:1438:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1440:filesystem-read:fs.realpath",
    "src/builder-codex-host.js:1537:filesystem-lifecycle:fs.rename",
    "src/builder-codex-host.js:1593:filesystem-lifecycle:fs.rename",
    "src/builder-codex-host.js:1600:filesystem-lifecycle:fs.unlink",
    "src/builder-codex-host.js:1611:filesystem-lifecycle:fs.link",
    "src/builder-codex-host.js:1612:filesystem-lifecycle:fs.unlink",
    "src/builder-install.js:1135:filesystem-read:fs.lstat",
    "src/builder-install.js:1163:filesystem-read:fs.lstat",
    "src/builder-install.js:1167:filesystem-read:fs.readFile",
    "src/builder-install.js:1200:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1203:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1206:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1207:filesystem-open:fs.open",
    "src/builder-install.js:1213:file-handle:FileHandle.writeFile",
    "src/builder-install.js:1214:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:1219:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:1253:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:1264:filesystem-read:fs.readdir",
    "src/builder-install.js:1470:filesystem-read:fs.realpath",
    "src/builder-install.js:1471:filesystem-read:fs.lstat",
    "src/builder-install.js:1482:filesystem-read:fs.realpath",
    "src/builder-install.js:1483:filesystem-read:fs.lstat",
    "src/builder-install.js:1501:filesystem-read:fs.realpath",
    "src/builder-install.js:1502:filesystem-read:fs.lstat",
    "src/builder-install.js:1657:filesystem-open:fs.open",
    "src/builder-install.js:1658:file-handle-read:FileHandle.stat",
    "src/builder-install.js:1659:filesystem-read:fs.lstat",
    "src/builder-install.js:1673:filesystem-read:fs.lstat",
    "src/builder-install.js:1715:filesystem-read:fs.lstat",
    "src/builder-install.js:1719:filesystem-read:fs.realpath",
    "src/builder-install.js:1806:filesystem-read:fs.realpath",
    "src/builder-install.js:1807:filesystem-read:fs.lstat",
    "src/builder-install.js:1834:filesystem-read:fs.lstat",
    "src/builder-install.js:1838:filesystem-read:fs.realpath",
    "src/builder-install.js:1869:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1874:filesystem-read:fs.lstat",
    "src/builder-install.js:1875:filesystem-read:fs.realpath",
    "src/builder-install.js:1890:filesystem-read:fs.lstat",
    "src/builder-install.js:1894:filesystem-read:fs.realpath",
    "src/builder-install.js:1925:filesystem-open:fs.open",
    "src/builder-install.js:1928:file-handle:FileHandle.write",
    "src/builder-install.js:1939:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:1940:file-handle-read:FileHandle.stat",
    "src/builder-install.js:1968:filesystem-lifecycle:fs.link",
    "src/builder-install.js:1975:filesystem-lifecycle:fs.unlink",
    "src/builder-install.js:1991:filesystem-read:fs.lstat",
    "src/builder-install.js:1997:filesystem-read:fs.lstat",
    "src/builder-install.js:2012:filesystem-read:fs.lstat",
    "src/builder-install.js:2013:filesystem-read:fs.lstat",
    "src/builder-install.js:2034:filesystem-lifecycle:fs.unlink",
    "src/builder-install.js:2076:filesystem-open:fs.open",
    "src/builder-install.js:2084:filesystem-read:fs.lstat",
    "src/builder-install.js:2088:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:2089:filesystem-read:fs.lstat",
    "src/builder-install.js:2093:filesystem-read:fs.realpath",
    "src/builder-install.js:2097:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2102:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2114:filesystem-lifecycle:fs.unlink",
    "src/builder-install.js:2128:filesystem-lifecycle:fs.unlink",
    "src/builder-install.js:2158:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2165:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2181:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2182:filesystem-read:fs.lstat",
    "src/builder-install.js:2197:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2200:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2211:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2220:filesystem-open:fs.open",
    "src/builder-install.js:2230:file-handle:FileHandle.write",
    "src/builder-install.js:2239:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:2240:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2241:filesystem-read:fs.lstat",
    "src/builder-install.js:2251:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2280:filesystem-read:fs.lstat",
    "src/builder-install.js:2285:filesystem-read:fs.realpath",
    "src/builder-install.js:2296:filesystem-open:fs.open",
    "src/builder-install.js:2297:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2301:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:2302:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2395:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:2396:filesystem-read:fs.lstat",
    "src/builder-install.js:2400:filesystem-read:fs.realpath",
    "src/builder-install.js:2428:filesystem-read:fs.lstat",
    "src/builder-install.js:2433:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2436:filesystem-read:fs.lstat",
    "src/builder-install.js:2454:filesystem-read:fs.lstat",
    "src/builder-install.js:2457:filesystem-read:fs.realpath",
    "src/builder-install.js:2468:filesystem-open:fs.open",
    "src/builder-install.js:2469:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2470:filesystem-read:fs.lstat",
    "src/builder-install.js:2484:filesystem-read:fs.lstat",
    "src/builder-install.js:2548:file-handle-read:FileHandle.read",
    "src/builder-lifecycle.js:2299:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2300:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2303:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:2323:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2324:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2325:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:2331:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2343:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2344:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2364:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:2390:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2393:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2413:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2415:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2527:filesystem-lifecycle:fs.mkdir",
    "src/builder-lifecycle.js:2532:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2533:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2537:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:2544:filesystem-lifecycle:fs.mkdir",
    "src/builder-lifecycle.js:2545:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2547:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2556:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2573:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2576:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2580:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2583:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2587:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2590:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2607:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:2619:filesystem-lifecycle:fs.rename",
    "src/builder-lifecycle.js:2620:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2623:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2633:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:2636:filesystem-lifecycle:fs.rmdir",
    "src/builder-lifecycle.js:2670:filesystem-open:fs.open",
    "src/builder-lifecycle.js:2671:filesystem-open:fs.open",
    "src/builder-lifecycle.js:2672:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:2673:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:2674:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2675:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2686:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:2687:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:2704:filesystem-lifecycle:fs.rmdir",
    "src/builder-lifecycle.js:2705:filesystem-lifecycle:fs.rmdir",
    "src/builder-lifecycle.js:2730:filesystem-open:fs.open",
    "src/builder-lifecycle.js:2736:file-handle-lifecycle:FileHandle.sync",
    "src/builder-lifecycle.js:2737:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:2765:filesystem-lifecycle:fs.link",
    "src/builder-lifecycle.js:2770:filesystem-lifecycle:fs.unlink",
    "src/builder-lifecycle.js:2806:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2811:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2871:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2875:filesystem-open:fs.open",
    "src/builder-lifecycle.js:2876:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:2877:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2886:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:2895:filesystem-lifecycle:fs.link",
    "src/builder-lifecycle.js:2935:filesystem-lifecycle:fs.rename",
    "src/builder-lifecycle.js:2969:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2972:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:2975:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:2976:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2983:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:2989:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:2996:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:3002:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:3015:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:3018:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:3019:filesystem-open:fs.open",
    "src/builder-lifecycle.js:3023:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:3024:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:3028:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:3033:filesystem-lifecycle:fs.link",
    "src/builder-lifecycle.js:3035:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:3036:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:3054:file-handle-read:FileHandle.read",
    "src/builder-lifecycle.js:3064:file-handle:FileHandle.write",
    "src/builder-lifecycle.js:3083:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:3084:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:3177:filesystem-open:fs.open",
    "src/builder-lifecycle.js:3178:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:3182:file-handle-lifecycle:FileHandle.sync",
  ]),
  ...classifyPhase("02", "03", "gated", [
  ]),
  ...classifyPhase("02", "06", "diagnostic", [
  ]),
  ...classifyPhase("02", "06", "non-artifact", [
  ]),
  ...classifyPhase("02", "06", "gated", [
  ]),
  ...classifyPhase("02", "07", "gated", [
  ]),
  ...classifyPhase("02", "14", "diagnostic", [
    "src/builder-doctor.js:717:filesystem-read:fs.lstat",
    "src/builder-doctor.js:784:filesystem-read:fs.realpath",
    "src/builder-doctor.js:785:filesystem-read:fs.lstat",
    "src/builder-doctor.js:859:filesystem-read:fs.lstat",
    "src/builder-doctor.js:865:filesystem-read:fs.realpath",
    "src/builder-doctor.js:869:filesystem-open:fs.open",
    "src/builder-doctor.js:876:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:877:filesystem-read:fs.lstat",
    "src/builder-doctor.js:889:filesystem-read:fs.lstat",
    "src/builder-doctor.js:901:filesystem-open:fs.open",
    "src/builder-doctor.js:905:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:906:filesystem-read:fs.lstat",
    "src/builder-doctor.js:916:file-handle-read:FileHandle.read",
    "src/builder-doctor.js:971:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:972:filesystem-read:fs.lstat",
    "src/builder-doctor.js:986:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:987:filesystem-read:fs.lstat",
    "src/builder-doctor.js:988:filesystem-read:fs.realpath",
  ]),
  ...classifyPhase("02", "08", "transient-runtime", [
  ]),
  ...classifyPhase("02", "08", "non-artifact", [
  ]),
  ...classifyPhase("02", "04", "gated", [
  ]),
  ...classifyPhase("02", "07", "gated", [
  ]),
  ...classifyPhase("02", "09", "gated", [
  ]),
  ...classify("11", "gated", [
  ]),
  ...classify("11", "non-artifact", [
  ]),
  ...classify("11", "diagnostic", [
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
    "scripts/node20-core-receipt.js:812:process-output:process.stderr.write",
  ]),
  ...classifyPhase("01.2", "11", "non-artifact-intake", [
    "scripts/node20-core-receipt.js:127:filesystem-read:fs.realpath",
    "scripts/node20-core-receipt.js:128:filesystem-read:fs.realpath",
    "scripts/node20-core-receipt.js:129:filesystem-read:fs.stat",
    "scripts/node20-core-receipt.js:150:filesystem-read:fs.readFile",
    "scripts/node20-core-receipt.js:183:filesystem-read:fs.readFile",
    "scripts/node20-core-receipt.js:276:filesystem-read:fs.readFile",
    "scripts/node20-core-receipt.js:465:filesystem-read:fs.createReadStream",
    "scripts/node20-core-receipt.js:566:filesystem-read:fs.stat",
    "scripts/node20-core-receipt.js:576:filesystem-read:fs.createReadStream",
    "scripts/node20-core-receipt.js:588:filesystem-read:fs.lstat",
    "scripts/node20-core-receipt.js:791:filesystem-read:fs.realpath",
    "scripts/node20-core-receipt.js:792:filesystem-read:fs.realpath",
  ]),
  ...classifyPhase("01.2", "11", "gated", [
    "scripts/node20-core-receipt.js:354:managed-writer:persistability.writePersistableJsonAtomic",
  ]),
  ...classifyPhase("01.2", "11", "non-artifact", [
    "scripts/node20-core-receipt.js:357:process-output:process.stdout.write",
  ]),
  ...classify("13", "gated", [
    "scripts/live-smoke-summary.js:93:managed-writer:persistability.writePersistableJsonAtomic",
    "scripts/live-smoke-summary.js:98:serializer-to-sink:emitPersistableOutput",
    "scripts/live-smoke-summary.js:237:process-output:process.stdout.write",
    "src/artifact-admission.js:310:filesystem-open:file.openInput",
    "src/artifact-admission.js:311:file-handle-read:FileHandle.stat",
    "src/artifact-admission.js:321:file-handle-read:FileHandle.read",
    "src/artifact-admission.js:333:file-handle-read:FileHandle.stat",
    "src/blueprint.js:117:durable-loader:loadAdmittedArtifact",
    "src/control-snapshot.js:19:durable-loader:loadAdmittedArtifact",
    "src/design-plan.js:53:durable-loader:loadAdmittedArtifact",
    "src/discovery-db.js:34:durable-loader:loadAdmittedArtifact",
    "src/discovery.js:21:durable-loader:loadAdmittedArtifact",
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
    "src/migration-filesystem.js:473:file-handle-lifecycle:FileHandle.sync",
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
    "src/migration-filesystem.js:626:file-handle-lifecycle:FileHandle.sync",
    "src/migration-filesystem.js:630:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:714:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:729:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:734:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:736:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:773:filesystem-open:fs.open",
    "src/migration-filesystem.js:836:filesystem-open:fs.open",
    "src/migration-filesystem.js:845:file-handle-lifecycle:FileHandle.sync",
    "src/migration-filesystem.js:851:file-handle-lifecycle:FileHandle.truncate",
    "src/migration-filesystem.js:871:file-handle-lifecycle:FileHandle.sync",
    "src/migration-filesystem.js:865:file-handle-lifecycle:FileHandle.truncate",
    "src/migration-filesystem.js:874:file-handle-lifecycle:FileHandle.truncate",
    "src/migration-filesystem.js:888:file-handle-read:FileHandle.stat",
    "src/migration-filesystem.js:889:filesystem-read:fs.lstat",
    "src/migration-filesystem.js:937:filesystem-open:fs.open",
    "src/migration-filesystem.js:952:file-handle-read:FileHandle.read",
    "src/migration-filesystem.js:1148:filesystem-read:fs.lstat",
    "src/observation.js:18:durable-loader:loadAdmittedArtifact",
    "src/persistability.js:198:serializer-to-sink:sink",
    "src/persistability.js:638:managed-filesystem:io.mkdir",
    "src/persistability.js:640:managed-filesystem:io.rename",
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
  ]),
  ...classifyPhase("01.2", "06", "transient-runtime", [
  ]),
  ...classifyPhase("02", "15", "transient-runtime", [
    "src/builder-behavior-eval.js:560:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:561:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:562:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:563:filesystem:fs.writeFile",
    "src/builder-behavior-eval.js:564:filesystem:fs.writeFile",
  ]),
  ...classifyPhase("02", "15", "ephemeral-secret", [
  ]),
  ...classifyPhase("02", "15", "non-artifact", [
  ]),
  ...classifyPhase("02", "15", "diagnostic", [
  ]),
  ...classifyPhase("02", "15", "gated", [
    "src/builder-behavior-eval.js:114:filesystem-lifecycle:fs.mkdtemp",
    "src/builder-behavior-eval.js:117:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:212:filesystem-lifecycle:fs.rm",
    "src/builder-behavior-eval.js:616:filesystem:fs.writeFile",
    "src/builder-behavior-eval.js:657:stream-write:stdin.end",
  ]),
  ...classifyPhase("02", "16", "transient-runtime", [
    "src/cli.js:2726:filesystem-read:fs.readFile",
  ]),
  ...classifyPhase("02", "16", "ephemeral-secret", [
    "src/cli.js:2752:filesystem-read:fs.readFile",
  ]),
  ...classifyPhase("02", "16", "non-artifact", [
    "src/cli.js:1853:process-output:process.stdout.write",
  ]),
  ...classifyPhase("02", "16", "diagnostic", [
    "src/cli.js:1857:process-output:process.stdout.write",
    "src/cli.js:1861:process-output:process.stderr.write",
  ]),
  ...classifyPhase("02", "16", "gated", [
    "src/builder-codex-uat-continuation.js:108:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:388:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:446:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:447:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:448:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:452:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:453:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:466:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:470:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:471:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:482:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:484:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:494:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:495:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:501:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:544:file-handle-read:FileHandle.read",
    "src/cli.js:425:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:450:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:455:durable-loader:loadAdmittedArtifact",
    "src/cli.js:538:durable-loader:loadAdmittedArtifact",
    "src/cli.js:543:durable-loader:loadAdmittedArtifact",
    "src/cli.js:569:durable-loader:loadAdmittedArtifact",
    "src/cli.js:574:durable-loader:loadAdmittedArtifact",
    "src/cli.js:580:durable-loader:loadAdmittedArtifact",
    "src/cli.js:609:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:634:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:665:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:677:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:693:durable-loader:loadAdmittedArtifact",
    "src/cli.js:767:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:771:durable-loader:loadAdmittedArtifact",
    "src/cli.js:776:durable-loader:loadAdmittedArtifact",
    "src/cli.js:781:durable-loader:loadAdmittedArtifact",
    "src/cli.js:806:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:810:durable-loader:loadAdmittedArtifact",
    "src/cli.js:829:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:833:durable-loader:loadAdmittedArtifact",
    "src/cli.js:838:durable-loader:loadAdmittedArtifact",
    "src/cli.js:843:durable-loader:loadAdmittedArtifact",
    "src/cli.js:849:durable-loader:loadAdmittedArtifact",
    "src/cli.js:861:durable-loader:loadAdmittedArtifact",
    "src/cli.js:910:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:1746:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1758:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1771:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1849:process-output:process.stdout.write",
  ]),
  ...classifyPhase("02", "17", "gated", [
    "scripts/build-builder-uat-releases.js:81:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:92:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:93:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:94:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:104:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:105:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:111:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:112:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:139:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:192:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:220:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:223:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:238:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:239:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:240:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:242:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:256:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:273:filesystem-read:fs.realpath",
    "scripts/build-builder-uat-releases.js:282:filesystem-lifecycle:fs.mkdtemp",
    "scripts/build-builder-uat-releases.js:284:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:306:filesystem-lifecycle:fs.rename",
    "scripts/build-builder-uat-releases.js:314:filesystem-lifecycle:fs.rm",
    "scripts/build-builder-uat-releases.js:319:managed-writer:channel.write",
    "scripts/verify-codex-uat-candidate.js:194:managed-writer:channel.write",
    "src/builder-codex-uat.js:1196:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-uat.js:1200:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1207:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1230:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1231:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1232:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1239:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1240:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1339:file-handle-read:FileHandle.read",
    "src/builder-codex-uat.js:1349:file-handle:FileHandle.write",
    "src/builder-package.js:191:filesystem-read:fs.lstat",
    "src/builder-package.js:196:filesystem-open:fs.open",
    "src/builder-package.js:197:file-handle-read:FileHandle.stat",
    "src/builder-package.js:200:file-handle-read:FileHandle.stat",
    "src/builder-package.js:201:filesystem-read:fs.lstat",
    "src/builder-package.js:223:file-handle-read:FileHandle.read",
    "src/builder-package.js:943:filesystem-read:fs.lstat",
    "src/builder-package.js:947:filesystem-read:fs.realpath",
    "src/builder-package.js:958:filesystem-read:fs.lstat",
    "src/builder-package.js:984:filesystem-read:fs.realpath",
    "src/builder-package.js:1039:filesystem-read:fs.lstat",
    "src/builder-package.js:1040:filesystem-read:fs.realpath",
    "src/builder-package.js:1190:filesystem-read:fs.realpath",
    "src/builder-package.js:1219:filesystem-read:fs.lstat",
    "src/builder-package.js:1220:filesystem-read:fs.realpath",
  ]),
]);
// Canonical Phase 02 Plans 18-23 reconciliation. Each row remains explicit:
// moved rows are re-owned by the plan that established their current contract,
// and the repository-private preflight surfaces are owned by Plan 23.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  { file: "scripts/verify-codex-uat-candidate.js", owner: "phase-02-plan-18", status: "gated", ids: [
    "scripts/verify-codex-uat-candidate.js:88:managed-writer:channel.write",
  ] },
  { file: "src/builder-codex-host.js", owner: "phase-02-plan-19", status: "gated", ids: [
    "src/builder-codex-host.js:305:filesystem-open:fs.open",
    "src/builder-codex-host.js:1034:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:1035:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:1080:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1082:filesystem-open:fs.open",
    "src/builder-codex-host.js:1083:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1084:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:1085:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1086:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1122:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1124:filesystem-open:fs.open",
    "src/builder-codex-host.js:1125:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1126:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:1127:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1128:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1165:filesystem-open:fs.open",
    "src/builder-codex-host.js:1171:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1172:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1198:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1199:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1483:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1485:filesystem-open:fs.open",
    "src/builder-codex-host.js:1486:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1487:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:1488:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1489:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1622:stream-write:stdin.end",
    "src/builder-codex-host.js:1670:managed-writer:stdin.write",
    "src/builder-codex-host.js:1696:managed-writer:stdin.write",
    "src/builder-codex-host.js:1854:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1855:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1859:filesystem-read:fs.realpath",
    "src/builder-codex-host.js:1860:filesystem-read:fs.realpath",
    "src/builder-codex-host.js:1870:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1878:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:1884:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1892:filesystem-open:fs.open",
    "src/builder-codex-host.js:1894:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1895:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:1896:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1897:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1916:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:2181:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:2200:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:2268:filesystem-open:fs.open",
    "src/builder-codex-host.js:2274:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:2275:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:2276:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:2277:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:2342:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:2370:file-handle-read:FileHandle.read",
    "src/builder-codex-host.js:2517:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:2519:filesystem-read:fs.realpath",
  ] },
  { file: "src/builder-install.js", owner: "phase-02-plan-20", status: "gated", ids: [
    "src/builder-install.js:1314:filesystem-read:fs.lstat",
    "src/builder-install.js:1342:filesystem-read:fs.lstat",
    "src/builder-install.js:1346:filesystem-read:fs.readFile",
    "src/builder-install.js:1379:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1382:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1385:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1386:filesystem-open:fs.open",
    "src/builder-install.js:1392:file-handle:FileHandle.writeFile",
    "src/builder-install.js:1393:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:1398:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:1432:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:1443:filesystem-read:fs.readdir",
    "src/builder-install.js:1649:filesystem-read:fs.realpath",
    "src/builder-install.js:1650:filesystem-read:fs.lstat",
    "src/builder-install.js:1661:filesystem-read:fs.realpath",
    "src/builder-install.js:1662:filesystem-read:fs.lstat",
    "src/builder-install.js:1680:filesystem-read:fs.realpath",
    "src/builder-install.js:1681:filesystem-read:fs.lstat",
    "src/builder-install.js:1836:filesystem-open:fs.open",
    "src/builder-install.js:1837:file-handle-read:FileHandle.stat",
    "src/builder-install.js:1838:filesystem-read:fs.lstat",
    "src/builder-install.js:1853:filesystem-read:fs.lstat",
    "src/builder-install.js:1891:filesystem-read:fs.readdir",
    "src/builder-install.js:1893:filesystem-read:fs.lstat",
    "src/builder-install.js:1913:filesystem-read:fs.lstat",
    "src/builder-install.js:1917:filesystem-read:fs.realpath",
    "src/builder-install.js:2004:filesystem-read:fs.realpath",
    "src/builder-install.js:2005:filesystem-read:fs.lstat",
    "src/builder-install.js:2032:filesystem-read:fs.lstat",
    "src/builder-install.js:2036:filesystem-read:fs.realpath",
    "src/builder-install.js:2067:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:2072:filesystem-read:fs.lstat",
    "src/builder-install.js:2073:filesystem-read:fs.realpath",
    "src/builder-install.js:2088:filesystem-read:fs.lstat",
    "src/builder-install.js:2092:filesystem-read:fs.realpath",
    "src/builder-install.js:2120:filesystem-read:fs.lstat",
    "src/builder-install.js:2123:filesystem-read:fs.realpath",
    "src/builder-install.js:2142:filesystem-read:fs.lstat",
    "src/builder-install.js:2199:filesystem-open:fs.open",
    "src/builder-install.js:2207:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:2214:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2215:filesystem-read:fs.lstat",
    "src/builder-install.js:2220:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2221:filesystem-read:fs.lstat",
    "src/builder-install.js:2224:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2225:filesystem-open:fs.open",
    "src/builder-install.js:2230:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:2279:filesystem-open:fs.open",
    "src/builder-install.js:2283:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2284:filesystem-read:fs.lstat",
    "src/builder-install.js:2293:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2294:filesystem-read:fs.lstat",
    "src/builder-install.js:2529:filesystem-read:fs.lstat",
    "src/builder-install.js:2540:filesystem-open:fs.open",
    "src/builder-install.js:2542:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2549:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2551:filesystem-read:fs.lstat",
    "src/builder-install.js:2552:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2554:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2568:filesystem-read:fs.lstat",
    "src/builder-install.js:2580:filesystem-open:fs.open",
    "src/builder-install.js:2582:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2589:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2590:filesystem-read:fs.lstat",
    "src/builder-install.js:2591:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2595:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2596:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2609:filesystem-open:fs.open",
    "src/builder-install.js:2610:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2611:filesystem-read:fs.lstat",
    "src/builder-install.js:2617:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2650:filesystem-read:fs.lstat",
    "src/builder-install.js:2659:filesystem-open:fs.open",
    "src/builder-install.js:2661:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2662:filesystem-read:fs.lstat",
    "src/builder-install.js:2674:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2696:file-handle:FileHandle.write",
    "src/builder-install.js:2717:filesystem-open:fs.open",
    "src/builder-install.js:2720:file-handle:FileHandle.write",
    "src/builder-install.js:2731:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:2732:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2773:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2774:filesystem-read:fs.lstat",
    "src/builder-install.js:2775:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2785:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2790:filesystem-read:fs.lstat",
    "src/builder-install.js:2794:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2795:filesystem-read:fs.lstat",
    "src/builder-install.js:2796:filesystem-lifecycle:fs.unlink",
    "src/builder-install.js:2821:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2826:filesystem-read:fs.lstat",
    "src/builder-install.js:2827:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2828:filesystem-lifecycle:fs.unlink",
    "src/builder-install.js:2834:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2835:filesystem-read:fs.lstat",
    "src/builder-install.js:2845:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2846:filesystem-read:fs.lstat",
    "src/builder-install.js:2863:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2864:filesystem-read:fs.lstat",
    "src/builder-install.js:2865:filesystem-read:fs.lstat",
    "src/builder-install.js:2888:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2907:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2962:filesystem-open:fs.open",
    "src/builder-install.js:2970:filesystem-read:fs.lstat",
    "src/builder-install.js:2974:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:2975:filesystem-read:fs.lstat",
    "src/builder-install.js:2979:filesystem-read:fs.realpath",
    "src/builder-install.js:2983:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:2995:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2996:filesystem-read:fs.lstat",
    "src/builder-install.js:3005:filesystem-lifecycle:fs.link",
    "src/builder-install.js:3010:filesystem-read:fs.lstat",
    "src/builder-install.js:3021:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:3022:filesystem-read:fs.lstat",
    "src/builder-install.js:3023:filesystem-lifecycle:fs.unlink",
    "src/builder-install.js:3068:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3075:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3091:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3092:filesystem-read:fs.lstat",
    "src/builder-install.js:3107:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3110:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3121:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3130:filesystem-open:fs.open",
    "src/builder-install.js:3140:file-handle:FileHandle.write",
    "src/builder-install.js:3149:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:3150:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3151:filesystem-read:fs.lstat",
    "src/builder-install.js:3161:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3190:filesystem-read:fs.lstat",
    "src/builder-install.js:3195:filesystem-read:fs.realpath",
    "src/builder-install.js:3206:filesystem-open:fs.open",
    "src/builder-install.js:3207:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3211:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:3212:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3305:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:3306:filesystem-read:fs.lstat",
    "src/builder-install.js:3310:filesystem-read:fs.realpath",
    "src/builder-install.js:3338:filesystem-read:fs.lstat",
    "src/builder-install.js:3343:filesystem-lifecycle:fs.rename",
    "src/builder-install.js:3346:filesystem-read:fs.lstat",
    "src/builder-install.js:3364:filesystem-read:fs.lstat",
    "src/builder-install.js:3367:filesystem-read:fs.realpath",
    "src/builder-install.js:3378:filesystem-open:fs.open",
    "src/builder-install.js:3379:file-handle-read:FileHandle.stat",
    "src/builder-install.js:3380:filesystem-read:fs.lstat",
    "src/builder-install.js:3394:filesystem-read:fs.lstat",
    "src/builder-install.js:3458:file-handle-read:FileHandle.read",
  ] },
  { file: "src/builder-immutable-journal.js", owner: "phase-02-plan-21", status: "gated", ids: [
    "src/builder-immutable-journal.js:57:filesystem-lifecycle:fs.mkdir",
    "src/builder-immutable-journal.js:127:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:142:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:167:filesystem-lifecycle:fs.link",
    "src/builder-immutable-journal.js:188:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:245:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:302:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:314:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:413:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:415:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:419:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:420:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:424:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:442:filesystem-lifecycle:fs.mkdir",
    "src/builder-immutable-journal.js:447:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:449:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:453:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:454:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:473:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:474:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:486:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:487:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:499:filesystem-read:fs.readdir",
    "src/builder-immutable-journal.js:586:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:588:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:592:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:593:filesystem-read:fs.readdir",
    "src/builder-immutable-journal.js:598:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:601:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:684:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:774:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:790:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:852:filesystem-lifecycle:fs.rename",
    "src/builder-immutable-journal.js:853:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:857:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:1039:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:1057:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:1063:file-handle-read:FileHandle.read",
    "src/builder-immutable-journal.js:1081:file-handle:FileHandle.write",
    "src/builder-immutable-journal.js:1089:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:1090:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:1106:filesystem-read:fs.lstat",
  ] },
  { file: "src/builder-codex-uat.js", owner: "phase-02-plan-22", status: "gated", ids: [
    "src/builder-codex-uat.js:1494:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-uat.js:1495:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1499:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1500:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1546:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1565:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1581:filesystem-lifecycle:fs.link",
    "src/builder-codex-uat.js:1600:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1614:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1670:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1671:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1703:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1704:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1723:filesystem-lifecycle:fs.unlink",
    "src/builder-codex-uat.js:1748:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1761:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1766:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1767:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1773:filesystem-lifecycle:fs.unlink",
    "src/builder-codex-uat.js:1799:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1800:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1801:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1808:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1809:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1908:file-handle-read:FileHandle.read",
    "src/builder-codex-uat.js:1918:file-handle:FileHandle.write",
  ] },
  { file: "src/builder-codex-uat-continuation.js", owner: "phase-02-plan-22", status: "gated", ids: [
    "src/builder-codex-uat-continuation.js:160:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:497:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:504:file-handle:FileHandle.write",
    "src/builder-codex-uat-continuation.js:508:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-continuation.js:509:filesystem-lifecycle:fs.link",
    "src/builder-codex-uat-continuation.js:510:filesystem-lifecycle:fs.rename",
    "src/builder-codex-uat-continuation.js:511:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:516:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-continuation.js:528:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:529:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:530:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:549:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:606:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:664:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:665:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:666:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:670:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:671:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:684:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:688:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:689:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:700:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:702:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:712:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:713:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:719:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:762:file-handle-read:FileHandle.read",
  ] },
  { file: "src/builder-codex-uat-private-authority.js", owner: "phase-02-plan-23", status: "gated", ids: [
    "src/builder-codex-uat-private-authority.js:219:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-uat-private-authority.js:225:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:326:filesystem-read:fs.readdir",
    "src/builder-codex-uat-private-authority.js:552:filesystem-read:fs.realpath",
    "src/builder-codex-uat-private-authority.js:554:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:566:filesystem-read:fs.realpath",
    "src/builder-codex-uat-private-authority.js:567:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:581:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:583:filesystem-read:fs.realpath",
    "src/builder-codex-uat-private-authority.js:586:filesystem-open:fs.open",
    "src/builder-codex-uat-private-authority.js:587:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:588:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:602:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:604:filesystem-open:fs.open",
    "src/builder-codex-uat-private-authority.js:605:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:606:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:618:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:619:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:631:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:632:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:685:filesystem-open:fs.open",
    "src/builder-codex-uat-private-authority.js:705:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:716:filesystem-lifecycle:fs.link",
    "src/builder-codex-uat-private-authority.js:727:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:743:filesystem-open:fs.open",
    "src/builder-codex-uat-private-authority.js:749:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:760:filesystem-lifecycle:fs.link",
    "src/builder-codex-uat-private-authority.js:769:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:791:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:825:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:868:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-uat-private-authority.js:872:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:912:filesystem-lifecycle:fs.rename",
    "src/builder-codex-uat-private-authority.js:913:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:914:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:930:filesystem-lifecycle:fs.rename",
    "src/builder-codex-uat-private-authority.js:931:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:938:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:939:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:949:filesystem-read:fs.readdir",
    "src/builder-codex-uat-private-authority.js:1067:file-handle-read:FileHandle.read",
    "src/builder-codex-uat-private-authority.js:1077:file-handle:FileHandle.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "transient-runtime", ids: [
    "src/cli.js:2845:filesystem-read:fs.readFile",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "ephemeral-secret", ids: [
    "src/cli.js:2871:filesystem-read:fs.readFile",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "non-artifact", ids: [
    "src/cli.js:1972:process-output:process.stdout.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "diagnostic", ids: [
    "src/cli.js:1976:process-output:process.stdout.write",
    "src/cli.js:1980:process-output:process.stderr.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "gated", ids: [
    "src/cli.js:451:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:476:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:481:durable-loader:loadAdmittedArtifact",
    "src/cli.js:564:durable-loader:loadAdmittedArtifact",
    "src/cli.js:569:durable-loader:loadAdmittedArtifact",
    "src/cli.js:595:durable-loader:loadAdmittedArtifact",
    "src/cli.js:600:durable-loader:loadAdmittedArtifact",
    "src/cli.js:606:durable-loader:loadAdmittedArtifact",
    "src/cli.js:635:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:660:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:691:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:703:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:719:durable-loader:loadAdmittedArtifact",
    "src/cli.js:793:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:797:durable-loader:loadAdmittedArtifact",
    "src/cli.js:802:durable-loader:loadAdmittedArtifact",
    "src/cli.js:807:durable-loader:loadAdmittedArtifact",
    "src/cli.js:832:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:836:durable-loader:loadAdmittedArtifact",
    "src/cli.js:855:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:859:durable-loader:loadAdmittedArtifact",
    "src/cli.js:864:durable-loader:loadAdmittedArtifact",
    "src/cli.js:869:durable-loader:loadAdmittedArtifact",
    "src/cli.js:875:durable-loader:loadAdmittedArtifact",
    "src/cli.js:887:durable-loader:loadAdmittedArtifact",
    "src/cli.js:936:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:1865:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1877:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1890:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1968:process-output:process.stdout.write",
  ] },
  { file: "scripts/preflight-codex-uat-prior-attempt.js", owner: "phase-02-plan-23", status: "ephemeral-secret", ids: [
    "scripts/preflight-codex-uat-prior-attempt.js:40:filesystem-read:fs.readFile",
  ] },
  { file: "scripts/preflight-codex-uat-prior-attempt.js", owner: "phase-02-plan-23", status: "diagnostic", ids: [
    "scripts/preflight-codex-uat-prior-attempt.js:80:managed-writer:output.write",
    "scripts/preflight-codex-uat-prior-attempt.js:84:managed-writer:errorOutput.write",
  ] },
]);

// Deep-review reconciliation: enumeration is exact; semantic no-delete policy is separate.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  { file: "plugin/hooks/agentmo-hook.js", owner: "phase-02-plan-17", status: "gated", ids: [
    "plugin/hooks/agentmo-hook.js:35:filesystem-read:fs.lstat",
    "plugin/hooks/agentmo-hook.js:37:filesystem-read:fs.realpath",
    "plugin/hooks/agentmo-hook.js:50:filesystem-read:fs.realpath",
    "plugin/hooks/agentmo-hook.js:53:filesystem-read:fs.lstat",
    "plugin/hooks/agentmo-hook.js:54:filesystem-read:fs.lstat",
    "plugin/hooks/agentmo-hook.js:55:filesystem-read:fs.lstat",
    "plugin/hooks/agentmo-hook.js:56:filesystem-read:fs.realpath",
    "plugin/hooks/agentmo-hook.js:57:filesystem-read:fs.realpath",
    "plugin/hooks/agentmo-hook.js:64:filesystem-read:fs.readFile",
    "plugin/hooks/agentmo-hook.js:122:stream-write:stdin.end",
    "plugin/hooks/agentmo-hook.js:223:process-output:process.stdout.write",
  ] },
  { file: "scripts/build-builder-uat-releases.js", owner: "phase-02-plan-17", status: "gated", ids: [
    "scripts/build-builder-uat-releases.js:87:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:106:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:112:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:116:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:129:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:137:file-handle:FileHandle.writeFile",
    "scripts/build-builder-uat-releases.js:138:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:139:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:160:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:164:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:171:filesystem-lifecycle:fs.link",
    "scripts/build-builder-uat-releases.js:178:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:183:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:184:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:191:file-handle-read:FileHandle.readFile",
    "scripts/build-builder-uat-releases.js:194:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:196:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:197:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:198:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:219:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:254:filesystem-read:fs.readdir",
    "scripts/build-builder-uat-releases.js:269:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:270:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:271:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:281:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:282:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:288:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:289:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:294:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:295:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:318:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:376:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:404:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:407:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:422:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:423:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:424:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:426:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:446:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:463:filesystem-read:fs.realpath",
    "scripts/build-builder-uat-releases.js:472:filesystem-lifecycle:fs.mkdtemp",
    "scripts/build-builder-uat-releases.js:474:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:506:managed-writer:channel.write",
  ] },
  { file: "src/builder-append-only-authority.js", owner: "phase-02-plan-19", status: "gated", ids: [
    "src/builder-append-only-authority.js:746:filesystem-read:fs.realpath",
    "src/builder-append-only-authority.js:750:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:758:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:764:filesystem-lifecycle:fs.mkdir",
    "src/builder-append-only-authority.js:767:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:778:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:790:filesystem-lifecycle:fs.mkdir",
    "src/builder-append-only-authority.js:793:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:801:filesystem-lifecycle:fs.mkdir",
    "src/builder-append-only-authority.js:804:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:809:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:851:filesystem-read:fs.readdir",
    "src/builder-append-only-authority.js:960:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:980:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:981:filesystem-read:fs.readlink",
    "src/builder-append-only-authority.js:982:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1004:filesystem-read:fs.readlink",
    "src/builder-append-only-authority.js:1019:filesystem-open:fs.open",
    "src/builder-append-only-authority.js:1020:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1027:file-handle-read:FileHandle.readFile",
    "src/builder-append-only-authority.js:1028:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1048:filesystem-open:fs.open",
    "src/builder-append-only-authority.js:1049:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1053:file-handle-read:FileHandle.readFile",
    "src/builder-append-only-authority.js:1054:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1073:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1075:filesystem-open:fs.open",
    "src/builder-append-only-authority.js:1079:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1080:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1101:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1102:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1118:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1145:filesystem-read:fs.readdir",
    "src/builder-append-only-authority.js:1155:file-handle-lifecycle:FileHandle.sync",
  ] },
  { file: "src/builder-posix-effect.js", owner: "phase-02-plan-19", status: "gated", ids: [
    "src/builder-posix-effect.js:108:file-handle-read:FileHandle.stat",
    "src/builder-posix-effect.js:109:file-handle-read:FileHandle.readFile",
    "src/builder-posix-effect.js:110:file-handle-read:FileHandle.stat",
    "src/builder-posix-effect.js:192:file-handle-read:FileHandle.stat",
    "src/builder-posix-effect.js:210:file-handle-lifecycle:FileHandle.sync",
    "src/builder-posix-effect.js:231:file-handle:FileHandle.writeFile",
    "src/builder-posix-effect.js:232:file-handle-lifecycle:FileHandle.sync",
    "src/builder-posix-effect.js:239:file-handle-lifecycle:FileHandle.sync",
    "src/builder-posix-effect.js:280:file-handle-read:FileHandle.readFile",
    "src/builder-posix-effect.js:286:file-handle-lifecycle:FileHandle.sync",
    "src/builder-posix-effect.js:289:file-handle-read:FileHandle.stat",
    "src/builder-posix-effect.js:389:stream-write:stdin.end",
  ] },
  { file: "src/builder-behavior-eval.js", owner: "phase-02-plan-15", status: "gated", ids: [
    "src/builder-behavior-eval.js:119:filesystem-lifecycle:fs.mkdtemp",
    "src/builder-behavior-eval.js:122:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:672:filesystem:fs.writeFile",
    "src/builder-behavior-eval.js:713:stream-write:stdin.end",
  ] },
  { file: "src/builder-behavior-eval.js", owner: "phase-02-plan-15", status: "transient-runtime", ids: [
    "src/builder-behavior-eval.js:615:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:616:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:617:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:618:filesystem:fs.writeFile",
    "src/builder-behavior-eval.js:619:filesystem:fs.writeFile",
  ] },
  { file: "src/builder-codex-host.js", owner: "phase-02-plan-19", status: "gated", ids: [
    "src/builder-codex-host.js:594:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-host.js:601:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-host.js:604:filesystem-open:fs.open",
    "src/builder-codex-host.js:613:file-handle:FileHandle.writeFile",
    "src/builder-codex-host.js:614:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-host.js:622:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-host.js:682:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:683:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:705:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:707:filesystem-open:fs.open",
    "src/builder-codex-host.js:708:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:709:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:710:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:711:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:748:filesystem-open:fs.open",
    "src/builder-codex-host.js:754:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:755:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:775:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:776:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:950:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:952:filesystem-open:fs.open",
    "src/builder-codex-host.js:953:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:954:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:955:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:956:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1084:stream-write:stdin.end",
    "src/builder-codex-host.js:1116:managed-writer:stdin.write",
    "src/builder-codex-host.js:1142:managed-writer:stdin.write",
    "src/builder-codex-host.js:1295:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1296:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1300:filesystem-read:fs.realpath",
    "src/builder-codex-host.js:1301:filesystem-read:fs.realpath",
    "src/builder-codex-host.js:1311:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1319:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:1325:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1333:filesystem-open:fs.open",
    "src/builder-codex-host.js:1335:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1336:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:1337:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1338:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1357:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1476:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-host.js:1485:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1487:filesystem-read:fs.realpath",
  ] },
  { file: "src/builder-codex-uat-continuation.js", owner: "phase-02-plan-22", status: "gated", ids: [
    "src/builder-codex-uat-continuation.js:206:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:869:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:870:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:889:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1054:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:1112:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:1113:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1114:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1122:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1123:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1136:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:1140:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1141:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1152:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1154:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1164:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1165:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1171:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1246:file-handle-read:FileHandle.read",
  ] },
  { file: "src/builder-codex-uat-private-authority.js", owner: "phase-02-plan-23", status: "gated", ids: [
    "src/builder-codex-uat-private-authority.js:222:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-uat-private-authority.js:228:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:574:filesystem-read:fs.realpath",
    "src/builder-codex-uat-private-authority.js:576:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:588:filesystem-read:fs.realpath",
    "src/builder-codex-uat-private-authority.js:589:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:603:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:605:filesystem-read:fs.realpath",
    "src/builder-codex-uat-private-authority.js:608:filesystem-open:fs.open",
    "src/builder-codex-uat-private-authority.js:609:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:610:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:624:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:626:filesystem-open:fs.open",
    "src/builder-codex-uat-private-authority.js:627:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:628:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:640:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:641:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:653:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:654:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:833:filesystem-read:fs.readdir",
    "src/builder-codex-uat-private-authority.js:940:file-handle-read:FileHandle.read",
  ] },
  { file: "src/builder-codex-uat.js", owner: "phase-02-plan-22", status: "gated", ids: [
    "src/builder-codex-uat.js:1460:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-uat.js:1461:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1465:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1466:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1521:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1540:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1542:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1560:filesystem-lifecycle:fs.link",
    "src/builder-codex-uat.js:1566:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1589:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1590:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1620:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1647:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1648:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1680:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1681:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1721:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1722:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1723:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1741:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1742:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1757:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1778:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1785:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1791:filesystem-read:fs.readdir",
    "src/builder-codex-uat.js:1798:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1805:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1809:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1810:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1828:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1838:filesystem-read:fs.readdir",
    "src/builder-codex-uat.js:1930:file-handle-read:FileHandle.read",
    "src/builder-codex-uat.js:1940:file-handle:FileHandle.write",
  ] },
  { file: "src/builder-doctor.js", owner: "phase-02-plan-14", status: "diagnostic", ids: [
    "src/builder-doctor.js:801:filesystem-read:fs.lstat",
    "src/builder-doctor.js:868:filesystem-read:fs.realpath",
    "src/builder-doctor.js:869:filesystem-read:fs.lstat",
    "src/builder-doctor.js:943:filesystem-read:fs.lstat",
    "src/builder-doctor.js:949:filesystem-read:fs.realpath",
    "src/builder-doctor.js:953:filesystem-open:fs.open",
    "src/builder-doctor.js:960:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:961:filesystem-read:fs.lstat",
    "src/builder-doctor.js:973:filesystem-read:fs.lstat",
    "src/builder-doctor.js:985:filesystem-open:fs.open",
    "src/builder-doctor.js:989:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:990:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1000:file-handle-read:FileHandle.read",
    "src/builder-doctor.js:1067:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1068:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1082:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1083:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1084:filesystem-read:fs.realpath",
  ] },
  { file: "src/builder-immutable-journal.js", owner: "phase-02-plan-21", status: "gated", ids: [
    "src/builder-immutable-journal.js:91:filesystem-lifecycle:fs.mkdir",
    "src/builder-immutable-journal.js:410:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:412:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:416:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:417:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:421:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:437:filesystem-read:fs.readdir",
    "src/builder-immutable-journal.js:745:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:757:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:791:filesystem-lifecycle:fs.link",
    "src/builder-immutable-journal.js:819:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:957:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:963:file-handle-read:FileHandle.read",
    "src/builder-immutable-journal.js:981:file-handle:FileHandle.write",
    "src/builder-immutable-journal.js:989:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:990:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:1003:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:1004:filesystem-read:fs.lstat",
  ] },
  { file: "src/builder-install.js", owner: "phase-02-plan-20", status: "gated", ids: [
    "src/builder-install.js:1218:filesystem-read:fs.lstat",
    "src/builder-install.js:1246:filesystem-read:fs.lstat",
    "src/builder-install.js:1250:filesystem-read:fs.readFile",
    "src/builder-install.js:1283:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1285:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1288:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1289:filesystem-open:fs.open",
    "src/builder-install.js:1295:file-handle:FileHandle.writeFile",
    "src/builder-install.js:1296:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:1343:filesystem-read:fs.readdir",
    "src/builder-install.js:1549:filesystem-read:fs.realpath",
    "src/builder-install.js:1550:filesystem-read:fs.lstat",
    "src/builder-install.js:1561:filesystem-read:fs.realpath",
    "src/builder-install.js:1562:filesystem-read:fs.lstat",
    "src/builder-install.js:1580:filesystem-read:fs.realpath",
    "src/builder-install.js:1581:filesystem-read:fs.lstat",
    "src/builder-install.js:1721:filesystem-open:fs.open",
    "src/builder-install.js:1722:file-handle-read:FileHandle.stat",
    "src/builder-install.js:1723:filesystem-read:fs.lstat",
    "src/builder-install.js:1743:filesystem-read:fs.lstat",
    "src/builder-install.js:1782:filesystem-read:fs.readdir",
    "src/builder-install.js:1785:filesystem-read:fs.lstat",
    "src/builder-install.js:1817:filesystem-read:fs.lstat",
    "src/builder-install.js:1836:filesystem-read:fs.lstat",
    "src/builder-install.js:1840:filesystem-read:fs.realpath",
    "src/builder-install.js:1927:filesystem-read:fs.realpath",
    "src/builder-install.js:1928:filesystem-read:fs.lstat",
    "src/builder-install.js:1955:filesystem-read:fs.lstat",
    "src/builder-install.js:1959:filesystem-read:fs.realpath",
    "src/builder-install.js:1990:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1995:filesystem-read:fs.lstat",
    "src/builder-install.js:1996:filesystem-read:fs.realpath",
    "src/builder-install.js:2011:filesystem-read:fs.lstat",
    "src/builder-install.js:2015:filesystem-read:fs.realpath",
    "src/builder-install.js:2046:filesystem-open:fs.open",
    "src/builder-install.js:2049:file-handle:FileHandle.write",
    "src/builder-install.js:2060:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:2061:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2107:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2112:filesystem-read:fs.lstat",
    "src/builder-install.js:2113:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2118:filesystem-open:fs.open",
    "src/builder-install.js:2122:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:2143:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2144:filesystem-read:fs.lstat",
    "src/builder-install.js:2154:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2155:filesystem-read:fs.lstat",
    "src/builder-install.js:2172:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2173:filesystem-read:fs.lstat",
    "src/builder-install.js:2174:filesystem-read:fs.lstat",
    "src/builder-install.js:2299:file-handle-read:FileHandle.read",
  ] },
  { file: "src/builder-lifecycle.js", owner: "phase-02-plan-13", status: "gated", ids: [
    "src/builder-lifecycle.js:603:filesystem-open:fs.open",
    "src/builder-lifecycle.js:608:file-handle:FileHandle.writeFile",
    "src/builder-lifecycle.js:609:file-handle-lifecycle:FileHandle.sync",
    "src/builder-lifecycle.js:618:filesystem-lifecycle:fs.link",
    "src/builder-lifecycle.js:682:filesystem-open:fs.open",
    "src/builder-lifecycle.js:683:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:688:file-handle-read:FileHandle.readFile",
    "src/builder-lifecycle.js:689:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:777:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:782:filesystem-lifecycle:fs.mkdir",
    "src/builder-lifecycle.js:785:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:796:filesystem-open:fs.open",
    "src/builder-lifecycle.js:797:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:802:file-handle-read:FileHandle.readFile",
    "src/builder-lifecycle.js:803:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:1125:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1126:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1129:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:1149:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1150:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1151:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:1157:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1169:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1170:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1190:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:1216:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1248:filesystem-open:fs.open",
    "src/builder-lifecycle.js:1249:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:1256:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:1257:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1294:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1312:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1314:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1337:file-handle-read:FileHandle.read",
    "src/builder-lifecycle.js:1347:file-handle:FileHandle.write",
    "src/builder-lifecycle.js:1366:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1367:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1464:filesystem-open:fs.open",
    "src/builder-lifecycle.js:1465:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:1469:file-handle-lifecycle:FileHandle.sync",
  ] },
  { file: "src/builder-package.js", owner: "phase-02-plan-17", status: "gated", ids: [
    "src/builder-package.js:251:filesystem-read:fs.lstat",
    "src/builder-package.js:256:filesystem-open:fs.open",
    "src/builder-package.js:257:file-handle-read:FileHandle.stat",
    "src/builder-package.js:260:file-handle-read:FileHandle.stat",
    "src/builder-package.js:261:filesystem-read:fs.lstat",
    "src/builder-package.js:283:file-handle-read:FileHandle.read",
    "src/builder-package.js:512:filesystem-read:fs.readdir",
    "src/builder-package.js:525:filesystem-read:fs.lstat",
    "src/builder-package.js:526:filesystem-read:fs.realpath",
    "src/builder-package.js:869:filesystem-read:fs.lstat",
    "src/builder-package.js:873:filesystem-read:fs.realpath",
    "src/builder-package.js:884:filesystem-read:fs.lstat",
    "src/builder-package.js:894:filesystem-read:fs.lstat",
    "src/builder-package.js:920:filesystem-read:fs.realpath",
    "src/builder-package.js:975:filesystem-read:fs.lstat",
    "src/builder-package.js:976:filesystem-read:fs.realpath",
    "src/builder-package.js:1117:filesystem-read:fs.lstat",
    "src/builder-package.js:1200:filesystem-read:fs.lstat",
    "src/builder-package.js:1204:filesystem-read:fs.realpath",
    "src/builder-package.js:1207:filesystem-open:fs.open",
    "src/builder-package.js:1208:file-handle-read:FileHandle.stat",
    "src/builder-package.js:1213:file-handle-read:FileHandle.stat",
    "src/builder-package.js:1214:filesystem-read:fs.lstat",
    "src/builder-package.js:1263:filesystem-read:fs.realpath",
    "src/builder-package.js:1292:filesystem-read:fs.lstat",
    "src/builder-package.js:1293:filesystem-read:fs.realpath",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "gated", ids: [
    "src/cli.js:444:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:469:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:474:durable-loader:loadAdmittedArtifact",
    "src/cli.js:557:durable-loader:loadAdmittedArtifact",
    "src/cli.js:562:durable-loader:loadAdmittedArtifact",
    "src/cli.js:588:durable-loader:loadAdmittedArtifact",
    "src/cli.js:593:durable-loader:loadAdmittedArtifact",
    "src/cli.js:599:durable-loader:loadAdmittedArtifact",
    "src/cli.js:628:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:653:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:684:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:696:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:712:durable-loader:loadAdmittedArtifact",
    "src/cli.js:786:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:790:durable-loader:loadAdmittedArtifact",
    "src/cli.js:795:durable-loader:loadAdmittedArtifact",
    "src/cli.js:800:durable-loader:loadAdmittedArtifact",
    "src/cli.js:825:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:829:durable-loader:loadAdmittedArtifact",
    "src/cli.js:848:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:852:durable-loader:loadAdmittedArtifact",
    "src/cli.js:857:durable-loader:loadAdmittedArtifact",
    "src/cli.js:862:durable-loader:loadAdmittedArtifact",
    "src/cli.js:868:durable-loader:loadAdmittedArtifact",
    "src/cli.js:880:durable-loader:loadAdmittedArtifact",
    "src/cli.js:929:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:1881:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1893:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1906:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1987:process-output:process.stdout.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "non-artifact", ids: [
    "src/cli.js:1991:process-output:process.stdout.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "diagnostic", ids: [
    "src/cli.js:1995:process-output:process.stdout.write",
    "src/cli.js:1999:process-output:process.stderr.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "transient-runtime", ids: [
    "src/cli.js:2864:filesystem-read:fs.readFile",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "ephemeral-secret", ids: [
    "src/cli.js:2890:filesystem-read:fs.readFile",
  ] },
]);

// WR-03 platform diagnostics shifted these two exact source surfaces.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  { file: "src/builder-doctor.js", owner: "phase-02-plan-14", status: "diagnostic", ids: [
    "src/builder-doctor.js:819:filesystem-read:fs.lstat",
    "src/builder-doctor.js:886:filesystem-read:fs.realpath",
    "src/builder-doctor.js:887:filesystem-read:fs.lstat",
    "src/builder-doctor.js:961:filesystem-read:fs.lstat",
    "src/builder-doctor.js:967:filesystem-read:fs.realpath",
    "src/builder-doctor.js:971:filesystem-open:fs.open",
    "src/builder-doctor.js:978:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:979:filesystem-read:fs.lstat",
    "src/builder-doctor.js:991:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1003:filesystem-open:fs.open",
    "src/builder-doctor.js:1007:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1008:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1018:file-handle-read:FileHandle.read",
    "src/builder-doctor.js:1085:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1086:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1100:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1101:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1102:filesystem-read:fs.realpath",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "gated", ids: [
    "src/cli.js:447:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:472:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:477:durable-loader:loadAdmittedArtifact",
    "src/cli.js:560:durable-loader:loadAdmittedArtifact",
    "src/cli.js:565:durable-loader:loadAdmittedArtifact",
    "src/cli.js:591:durable-loader:loadAdmittedArtifact",
    "src/cli.js:596:durable-loader:loadAdmittedArtifact",
    "src/cli.js:602:durable-loader:loadAdmittedArtifact",
    "src/cli.js:631:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:656:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:687:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:699:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:715:durable-loader:loadAdmittedArtifact",
    "src/cli.js:789:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:793:durable-loader:loadAdmittedArtifact",
    "src/cli.js:798:durable-loader:loadAdmittedArtifact",
    "src/cli.js:803:durable-loader:loadAdmittedArtifact",
    "src/cli.js:828:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:832:durable-loader:loadAdmittedArtifact",
    "src/cli.js:851:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:855:durable-loader:loadAdmittedArtifact",
    "src/cli.js:860:durable-loader:loadAdmittedArtifact",
    "src/cli.js:865:durable-loader:loadAdmittedArtifact",
    "src/cli.js:871:durable-loader:loadAdmittedArtifact",
    "src/cli.js:883:durable-loader:loadAdmittedArtifact",
    "src/cli.js:932:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:1884:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1896:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1909:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1990:process-output:process.stdout.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "non-artifact", ids: [
    "src/cli.js:1994:process-output:process.stdout.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "diagnostic", ids: [
    "src/cli.js:1998:process-output:process.stdout.write",
    "src/cli.js:2002:process-output:process.stderr.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "transient-runtime", ids: [
    "src/cli.js:2867:filesystem-read:fs.readFile",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "ephemeral-secret", ids: [
    "src/cli.js:2893:filesystem-read:fs.readFile",
  ] },
]);

// Deep-review aggregate integration: exact release-set authority jointly binds
// the public/retained tarballs; generic reads remain strictly nlink=1.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  { file: "scripts/build-builder-uat-releases.js", owner: "phase-02-plan-17", status: "gated", ids: [
    "scripts/build-builder-uat-releases.js:87:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:106:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:112:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:116:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:129:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:137:file-handle:FileHandle.writeFile",
    "scripts/build-builder-uat-releases.js:138:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:139:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:160:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:168:file-handle:FileHandle.writeFile",
    "scripts/build-builder-uat-releases.js:169:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:170:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:184:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:197:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:201:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:208:filesystem-lifecycle:fs.link",
    "scripts/build-builder-uat-releases.js:215:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:220:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:221:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:228:file-handle-read:FileHandle.readFile",
    "scripts/build-builder-uat-releases.js:231:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:233:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:234:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:235:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:252:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:280:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:281:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:282:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:283:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:290:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:291:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:340:filesystem-read:fs.readdir",
    "scripts/build-builder-uat-releases.js:384:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:385:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:386:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:396:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:397:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:403:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:404:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:409:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:410:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:433:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:491:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:519:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:522:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:537:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:538:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:539:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:541:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:561:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:578:filesystem-read:fs.realpath",
    "scripts/build-builder-uat-releases.js:587:filesystem-lifecycle:fs.mkdtemp",
    "scripts/build-builder-uat-releases.js:589:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:618:managed-writer:channel.write",
  ] },
  { file: "src/builder-package.js", owner: "phase-02-plan-17", status: "gated", ids: [
    "src/builder-package.js:253:filesystem-read:fs.lstat",
    "src/builder-package.js:258:filesystem-open:fs.open",
    "src/builder-package.js:259:file-handle-read:FileHandle.stat",
    "src/builder-package.js:262:file-handle-read:FileHandle.stat",
    "src/builder-package.js:263:filesystem-read:fs.lstat",
    "src/builder-package.js:297:filesystem-read:fs.lstat",
    "src/builder-package.js:305:filesystem-read:fs.lstat",
    "src/builder-package.js:327:filesystem-read:fs.realpath",
    "src/builder-package.js:372:filesystem-read:fs.lstat",
    "src/builder-package.js:373:filesystem-read:fs.lstat",
    "src/builder-package.js:374:filesystem-read:fs.lstat",
    "src/builder-package.js:375:filesystem-read:fs.lstat",
    "src/builder-package.js:402:filesystem-read:fs.readdir",
    "src/builder-package.js:403:filesystem-read:fs.lstat",
    "src/builder-package.js:414:filesystem-read:fs.lstat",
    "src/builder-package.js:415:filesystem-read:fs.lstat",
    "src/builder-package.js:416:filesystem-read:fs.lstat",
    "src/builder-package.js:417:filesystem-read:fs.lstat",
    "src/builder-package.js:582:file-handle-read:FileHandle.read",
    "src/builder-package.js:812:filesystem-read:fs.readdir",
    "src/builder-package.js:825:filesystem-read:fs.lstat",
    "src/builder-package.js:826:filesystem-read:fs.realpath",
    "src/builder-package.js:1169:filesystem-read:fs.lstat",
    "src/builder-package.js:1173:filesystem-read:fs.realpath",
    "src/builder-package.js:1184:filesystem-read:fs.lstat",
    "src/builder-package.js:1194:filesystem-read:fs.lstat",
    "src/builder-package.js:1220:filesystem-read:fs.realpath",
    "src/builder-package.js:1275:filesystem-read:fs.lstat",
    "src/builder-package.js:1276:filesystem-read:fs.realpath",
    "src/builder-package.js:1417:filesystem-read:fs.lstat",
    "src/builder-package.js:1500:filesystem-read:fs.lstat",
    "src/builder-package.js:1504:filesystem-read:fs.realpath",
    "src/builder-package.js:1507:filesystem-open:fs.open",
    "src/builder-package.js:1508:file-handle-read:FileHandle.stat",
    "src/builder-package.js:1513:file-handle-read:FileHandle.stat",
    "src/builder-package.js:1514:filesystem-read:fs.lstat",
    "src/builder-package.js:1563:filesystem-read:fs.realpath",
    "src/builder-package.js:1592:filesystem-read:fs.lstat",
    "src/builder-package.js:1593:filesystem-read:fs.realpath",
  ] },
  { file: "src/builder-codex-uat.js", owner: "phase-02-plan-22", status: "gated", ids: [
    "src/builder-codex-uat.js:1464:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-uat.js:1465:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1469:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1470:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1525:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1544:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1546:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1564:filesystem-lifecycle:fs.link",
    "src/builder-codex-uat.js:1570:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1593:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1594:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1624:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1651:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1652:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1684:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1685:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1725:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1726:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1727:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1745:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1746:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1761:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1782:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1789:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1795:filesystem-read:fs.readdir",
    "src/builder-codex-uat.js:1802:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1809:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1813:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1814:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1832:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1842:filesystem-read:fs.readdir",
    "src/builder-codex-uat.js:1934:file-handle-read:FileHandle.read",
    "src/builder-codex-uat.js:1944:file-handle:FileHandle.write",
  ] },
  { file: "src/builder-codex-uat-continuation.js", owner: "phase-02-plan-22", status: "gated", ids: [
    "src/builder-codex-uat-continuation.js:209:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:871:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:872:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:891:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1056:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:1114:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:1115:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1116:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1124:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1125:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1138:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:1142:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1143:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1154:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1156:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1166:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1167:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1173:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1248:file-handle-read:FileHandle.read",
  ] },
]);

// CR-01 through CR-10 deep-review reconciliation. This final block owns the
// exact post-hardening surfaces; semantic no-delete and admission tests remain
// independent of this enumeration.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  { file: "plugin/hooks/agentmo-hook.js", owner: "phase-02-plan-17", status: "gated", ids: [
    "plugin/hooks/agentmo-hook.js:35:filesystem-read:fs.lstat",
    "plugin/hooks/agentmo-hook.js:37:filesystem-read:fs.realpath",
    "plugin/hooks/agentmo-hook.js:50:filesystem-read:fs.realpath",
    "plugin/hooks/agentmo-hook.js:52:filesystem-read:fs.lstat",
    "plugin/hooks/agentmo-hook.js:53:filesystem-read:fs.lstat",
    "plugin/hooks/agentmo-hook.js:54:filesystem-read:fs.realpath",
    "plugin/hooks/agentmo-hook.js:60:filesystem-read:fs.readFile",
    "plugin/hooks/agentmo-hook.js:70:filesystem-read:fs.lstat",
    "plugin/hooks/agentmo-hook.js:71:filesystem-read:fs.realpath",
    "plugin/hooks/agentmo-hook.js:129:stream-write:stdin.end",
    "plugin/hooks/agentmo-hook.js:231:process-output:process.stdout.write",
  ] },
  { file: "scripts/build-builder-uat-releases.js", owner: "phase-02-plan-17", status: "gated", ids: [
    "scripts/build-builder-uat-releases.js:90:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:173:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:180:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:181:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:201:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:202:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:217:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:231:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:239:file-handle:FileHandle.writeFile",
    "scripts/build-builder-uat-releases.js:240:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:241:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:254:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:256:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:265:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:266:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:267:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:271:file-handle-read:FileHandle.readFile",
    "scripts/build-builder-uat-releases.js:275:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:277:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:278:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:296:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:300:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:307:filesystem-lifecycle:fs.link",
    "scripts/build-builder-uat-releases.js:315:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:320:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:321:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:326:file-handle-read:FileHandle.readFile",
    "scripts/build-builder-uat-releases.js:329:file-handle-lifecycle:FileHandle.sync",
    "scripts/build-builder-uat-releases.js:331:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:332:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:333:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:337:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:338:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:368:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:369:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:371:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:372:filesystem-open:fs.open",
    "scripts/build-builder-uat-releases.js:377:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:378:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:389:file-handle-read:FileHandle.readFile",
    "scripts/build-builder-uat-releases.js:390:file-handle-read:FileHandle.readFile",
    "scripts/build-builder-uat-releases.js:393:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:394:file-handle-read:FileHandle.stat",
    "scripts/build-builder-uat-releases.js:395:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:396:filesystem-read:fs.lstat",
    "scripts/build-builder-uat-releases.js:449:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:544:filesystem-read:fs.readdir",
    "scripts/build-builder-uat-releases.js:545:filesystem-read:fs.readdir",
    "scripts/build-builder-uat-releases.js:602:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:603:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:604:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:614:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:615:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:621:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:622:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:627:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:628:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:651:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:709:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:737:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:740:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:755:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:756:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:757:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:759:filesystem:fs.writeFile",
    "scripts/build-builder-uat-releases.js:779:filesystem-read:fs.readFile",
    "scripts/build-builder-uat-releases.js:796:filesystem-read:fs.realpath",
    "scripts/build-builder-uat-releases.js:805:filesystem-lifecycle:fs.mkdtemp",
    "scripts/build-builder-uat-releases.js:807:filesystem-lifecycle:fs.mkdir",
    "scripts/build-builder-uat-releases.js:836:managed-writer:channel.write",
  ] },
  { file: "scripts/preflight-codex-uat-prior-attempt.js", owner: "phase-02-plan-23", status: "ephemeral-secret", ids: [
    "scripts/preflight-codex-uat-prior-attempt.js:43:filesystem-read:fs.readFile",
  ] },
  { file: "scripts/preflight-codex-uat-prior-attempt.js", owner: "phase-02-plan-23", status: "diagnostic", ids: [
    "scripts/preflight-codex-uat-prior-attempt.js:83:managed-writer:output.write",
    "scripts/preflight-codex-uat-prior-attempt.js:87:managed-writer:errorOutput.write",
    "scripts/preflight-codex-uat-prior-attempt.js:140:process-output:process.stderr.write",
  ] },
  { file: "scripts/verify-codex-uat-candidate.js", owner: "phase-02-plan-18", status: "gated", ids: [
    "scripts/verify-codex-uat-candidate.js:89:managed-writer:channel.write",
  ] },
  { file: "src/builder-append-only-authority.js", owner: "phase-02-plan-19", status: "gated", ids: [
    "src/builder-append-only-authority.js:816:filesystem-read:fs.realpath",
    "src/builder-append-only-authority.js:820:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:828:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:834:filesystem-lifecycle:fs.mkdir",
    "src/builder-append-only-authority.js:837:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:848:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:860:filesystem-lifecycle:fs.mkdir",
    "src/builder-append-only-authority.js:863:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:871:filesystem-lifecycle:fs.mkdir",
    "src/builder-append-only-authority.js:874:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:879:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:929:filesystem-read:fs.readdir",
    "src/builder-append-only-authority.js:1035:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1055:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1056:filesystem-read:fs.readlink",
    "src/builder-append-only-authority.js:1057:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1079:filesystem-read:fs.readlink",
    "src/builder-append-only-authority.js:1094:filesystem-open:fs.open",
    "src/builder-append-only-authority.js:1095:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1102:file-handle-read:FileHandle.readFile",
    "src/builder-append-only-authority.js:1103:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1123:filesystem-open:fs.open",
    "src/builder-append-only-authority.js:1124:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1128:file-handle-read:FileHandle.readFile",
    "src/builder-append-only-authority.js:1129:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1148:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1150:filesystem-open:fs.open",
    "src/builder-append-only-authority.js:1154:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1155:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1176:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1177:filesystem-read:fs.lstat",
    "src/builder-append-only-authority.js:1193:file-handle-read:FileHandle.stat",
    "src/builder-append-only-authority.js:1220:filesystem-read:fs.readdir",
    "src/builder-append-only-authority.js:1230:file-handle-lifecycle:FileHandle.sync",
  ] },
  { file: "src/builder-behavior-eval.js", owner: "phase-02-plan-15", status: "gated", ids: [
    "src/builder-behavior-eval.js:125:filesystem-lifecycle:fs.mkdtemp",
    "src/builder-behavior-eval.js:128:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:732:filesystem:fs.writeFile",
    "src/builder-behavior-eval.js:773:stream-write:stdin.end",
  ] },
  { file: "src/builder-behavior-eval.js", owner: "phase-02-plan-15", status: "transient-runtime", ids: [
    "src/builder-behavior-eval.js:673:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:674:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:675:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:676:filesystem-lifecycle:fs.mkdir",
    "src/builder-behavior-eval.js:677:filesystem:fs.writeFile",
    "src/builder-behavior-eval.js:678:filesystem:fs.writeFile",
    "src/builder-behavior-eval.js:679:filesystem:fs.writeFile",
  ] },
  { file: "src/builder-codex-host.js", owner: "phase-02-plan-19", status: "gated", ids: [
    "src/builder-codex-host.js:634:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-host.js:641:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-host.js:644:filesystem-open:fs.open",
    "src/builder-codex-host.js:653:file-handle:FileHandle.writeFile",
    "src/builder-codex-host.js:654:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-host.js:662:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-host.js:723:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:724:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:769:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:771:filesystem-open:fs.open",
    "src/builder-codex-host.js:772:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:773:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:774:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:775:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:811:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:813:filesystem-open:fs.open",
    "src/builder-codex-host.js:814:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:815:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:816:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:817:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:854:filesystem-open:fs.open",
    "src/builder-codex-host.js:860:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:861:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:881:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:882:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1061:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1063:filesystem-open:fs.open",
    "src/builder-codex-host.js:1064:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1065:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:1066:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1067:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1196:stream-write:stdin.end",
    "src/builder-codex-host.js:1228:managed-writer:stdin.write",
    "src/builder-codex-host.js:1254:managed-writer:stdin.write",
    "src/builder-codex-host.js:1407:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1408:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1412:filesystem-read:fs.realpath",
    "src/builder-codex-host.js:1413:filesystem-read:fs.realpath",
    "src/builder-codex-host.js:1423:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1431:filesystem-read:fs.readdir",
    "src/builder-codex-host.js:1437:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1445:filesystem-open:fs.open",
    "src/builder-codex-host.js:1447:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1448:file-handle-read:FileHandle.readFile",
    "src/builder-codex-host.js:1449:file-handle-read:FileHandle.stat",
    "src/builder-codex-host.js:1450:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1469:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1588:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-host.js:1597:filesystem-read:fs.lstat",
    "src/builder-codex-host.js:1599:filesystem-read:fs.realpath",
  ] },
  { file: "src/builder-codex-uat-continuation.js", owner: "phase-02-plan-22", status: "gated", ids: [
    "src/builder-codex-uat-continuation.js:236:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:1097:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1098:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1117:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1308:filesystem-read:fs.realpath",
    "src/builder-codex-uat-continuation.js:1366:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:1367:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1368:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1376:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1377:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1390:filesystem-open:fs.open",
    "src/builder-codex-uat-continuation.js:1394:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1395:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1406:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1408:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1418:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-continuation.js:1419:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1425:filesystem-read:fs.lstat",
    "src/builder-codex-uat-continuation.js:1500:file-handle-read:FileHandle.read",
  ] },
  { file: "src/builder-codex-uat-private-authority.js", owner: "phase-02-plan-23", status: "gated", ids: [
    "src/builder-codex-uat-private-authority.js:225:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-uat-private-authority.js:231:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat-private-authority.js:583:filesystem-read:fs.realpath",
    "src/builder-codex-uat-private-authority.js:585:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:597:filesystem-read:fs.realpath",
    "src/builder-codex-uat-private-authority.js:598:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:612:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:614:filesystem-read:fs.realpath",
    "src/builder-codex-uat-private-authority.js:617:filesystem-open:fs.open",
    "src/builder-codex-uat-private-authority.js:618:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:619:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:633:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:635:filesystem-open:fs.open",
    "src/builder-codex-uat-private-authority.js:636:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:637:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:649:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:650:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:662:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat-private-authority.js:663:filesystem-read:fs.lstat",
    "src/builder-codex-uat-private-authority.js:842:filesystem-read:fs.readdir",
    "src/builder-codex-uat-private-authority.js:949:file-handle-read:FileHandle.read",
  ] },
  { file: "src/builder-codex-uat.js", owner: "phase-02-plan-22", status: "gated", ids: [
    "src/builder-codex-uat.js:1601:filesystem-lifecycle:fs.mkdir",
    "src/builder-codex-uat.js:1602:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1606:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1607:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1663:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1682:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1684:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1702:filesystem-lifecycle:fs.link",
    "src/builder-codex-uat.js:1708:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1731:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1732:file-handle-lifecycle:FileHandle.sync",
    "src/builder-codex-uat.js:1762:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1789:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1790:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1822:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1823:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1863:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1864:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1865:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1883:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1884:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1899:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1920:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1927:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1933:filesystem-read:fs.readdir",
    "src/builder-codex-uat.js:1940:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1947:filesystem-open:fs.open",
    "src/builder-codex-uat.js:1951:file-handle-read:FileHandle.stat",
    "src/builder-codex-uat.js:1952:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1970:filesystem-read:fs.lstat",
    "src/builder-codex-uat.js:1980:filesystem-read:fs.readdir",
    "src/builder-codex-uat.js:2072:file-handle-read:FileHandle.read",
    "src/builder-codex-uat.js:2082:file-handle:FileHandle.write",
  ] },
  { file: "src/builder-doctor.js", owner: "phase-02-plan-14", status: "diagnostic", ids: [
    "src/builder-doctor.js:833:filesystem-read:fs.lstat",
    "src/builder-doctor.js:902:filesystem-read:fs.realpath",
    "src/builder-doctor.js:903:filesystem-read:fs.lstat",
    "src/builder-doctor.js:977:filesystem-read:fs.lstat",
    "src/builder-doctor.js:983:filesystem-read:fs.realpath",
    "src/builder-doctor.js:987:filesystem-open:fs.open",
    "src/builder-doctor.js:994:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:995:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1007:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1019:filesystem-open:fs.open",
    "src/builder-doctor.js:1023:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1024:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1034:file-handle-read:FileHandle.read",
    "src/builder-doctor.js:1101:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1102:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1116:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1117:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1118:filesystem-read:fs.realpath",
  ] },
  { file: "src/builder-events.js", owner: "phase-02-plan-02", status: "gated", ids: [
    "src/builder-events.js:408:filesystem-open:file.openInput",
    "src/builder-events.js:409:file-handle-read:FileHandle.stat",
    "src/builder-events.js:414:file-handle-read:FileHandle.read",
    "src/builder-events.js:418:file-handle-read:FileHandle.stat",
  ] },
  { file: "src/builder-immutable-journal.js", owner: "phase-02-plan-21", status: "gated", ids: [
    "src/builder-immutable-journal.js:416:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:452:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:454:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:458:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:459:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:463:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:479:filesystem-read:fs.readdir",
    "src/builder-immutable-journal.js:878:file-handle-lifecycle:FileHandle.sync",
    "src/builder-immutable-journal.js:1016:filesystem-open:fs.open",
    "src/builder-immutable-journal.js:1022:file-handle-read:FileHandle.read",
    "src/builder-immutable-journal.js:1039:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:1040:filesystem-read:fs.lstat",
    "src/builder-immutable-journal.js:1053:file-handle-read:FileHandle.stat",
    "src/builder-immutable-journal.js:1054:filesystem-read:fs.lstat",
  ] },
  { file: "src/builder-install.js", owner: "phase-02-plan-20", status: "gated", ids: [
    "src/builder-install.js:453:filesystem-read:fs.lstat",
    "src/builder-install.js:518:filesystem-open:fs.open",
    "src/builder-install.js:519:file-handle-read:FileHandle.stat",
    "src/builder-install.js:520:filesystem-read:fs.lstat",
    "src/builder-install.js:531:file-handle-read:FileHandle.stat",
    "src/builder-install.js:532:filesystem-read:fs.lstat",
    "src/builder-install.js:1689:filesystem-read:fs.lstat",
    "src/builder-install.js:1717:filesystem-read:fs.lstat",
    "src/builder-install.js:1721:filesystem-read:fs.readFile",
    "src/builder-install.js:1754:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1756:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1759:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:1760:filesystem-open:fs.open",
    "src/builder-install.js:1766:file-handle:FileHandle.writeFile",
    "src/builder-install.js:1767:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:1814:filesystem-read:fs.readdir",
    "src/builder-install.js:2020:filesystem-read:fs.realpath",
    "src/builder-install.js:2021:filesystem-read:fs.lstat",
    "src/builder-install.js:2033:filesystem-read:fs.realpath",
    "src/builder-install.js:2034:filesystem-read:fs.lstat",
    "src/builder-install.js:2052:filesystem-read:fs.realpath",
    "src/builder-install.js:2053:filesystem-read:fs.lstat",
    "src/builder-install.js:2239:filesystem-read:fs.lstat",
    "src/builder-install.js:2240:filesystem-read:fs.lstat",
    "src/builder-install.js:2309:filesystem-open:fs.open",
    "src/builder-install.js:2310:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2311:filesystem-read:fs.lstat",
    "src/builder-install.js:2331:filesystem-read:fs.lstat",
    "src/builder-install.js:2370:filesystem-read:fs.readdir",
    "src/builder-install.js:2373:filesystem-read:fs.lstat",
    "src/builder-install.js:2405:filesystem-read:fs.lstat",
    "src/builder-install.js:2424:filesystem-read:fs.lstat",
    "src/builder-install.js:2428:filesystem-read:fs.realpath",
    "src/builder-install.js:2515:filesystem-read:fs.realpath",
    "src/builder-install.js:2516:filesystem-read:fs.lstat",
    "src/builder-install.js:2543:filesystem-read:fs.lstat",
    "src/builder-install.js:2547:filesystem-read:fs.realpath",
    "src/builder-install.js:2578:filesystem-lifecycle:fs.mkdir",
    "src/builder-install.js:2583:filesystem-read:fs.lstat",
    "src/builder-install.js:2584:filesystem-read:fs.realpath",
    "src/builder-install.js:2599:filesystem-read:fs.lstat",
    "src/builder-install.js:2603:filesystem-read:fs.realpath",
    "src/builder-install.js:2631:filesystem-open:fs.open",
    "src/builder-install.js:2664:filesystem-open:fs.open",
    "src/builder-install.js:2667:file-handle:FileHandle.write",
    "src/builder-install.js:2678:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:2679:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2725:filesystem-lifecycle:fs.link",
    "src/builder-install.js:2730:filesystem-read:fs.lstat",
    "src/builder-install.js:2731:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2736:filesystem-open:fs.open",
    "src/builder-install.js:2740:file-handle-lifecycle:FileHandle.sync",
    "src/builder-install.js:2767:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2768:filesystem-read:fs.lstat",
    "src/builder-install.js:2778:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2779:filesystem-read:fs.lstat",
    "src/builder-install.js:2796:file-handle-read:FileHandle.stat",
    "src/builder-install.js:2797:filesystem-read:fs.lstat",
    "src/builder-install.js:2798:filesystem-read:fs.lstat",
    "src/builder-install.js:2923:file-handle-read:FileHandle.read",
  ] },
  { file: "src/builder-lifecycle.js", owner: "phase-02-plan-13", status: "gated", ids: [
    "src/builder-lifecycle.js:635:filesystem-open:fs.open",
    "src/builder-lifecycle.js:640:file-handle:FileHandle.writeFile",
    "src/builder-lifecycle.js:641:file-handle-lifecycle:FileHandle.sync",
    "src/builder-lifecycle.js:650:filesystem-lifecycle:fs.link",
    "src/builder-lifecycle.js:790:filesystem-open:fs.open",
    "src/builder-lifecycle.js:791:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:796:file-handle-read:FileHandle.readFile",
    "src/builder-lifecycle.js:797:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:887:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:892:filesystem-lifecycle:fs.mkdir",
    "src/builder-lifecycle.js:895:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:906:filesystem-open:fs.open",
    "src/builder-lifecycle.js:907:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:912:file-handle-read:FileHandle.readFile",
    "src/builder-lifecycle.js:913:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:1369:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1370:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1373:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:1393:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1394:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1395:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:1401:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1413:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1414:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1434:filesystem-read:fs.readdir",
    "src/builder-lifecycle.js:1460:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1492:filesystem-open:fs.open",
    "src/builder-lifecycle.js:1493:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:1500:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:1501:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1538:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1556:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1558:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1581:file-handle-read:FileHandle.read",
    "src/builder-lifecycle.js:1591:file-handle:FileHandle.write",
    "src/builder-lifecycle.js:1610:filesystem-read:fs.realpath",
    "src/builder-lifecycle.js:1611:filesystem-read:fs.lstat",
    "src/builder-lifecycle.js:1708:filesystem-open:fs.open",
    "src/builder-lifecycle.js:1709:file-handle-read:FileHandle.stat",
    "src/builder-lifecycle.js:1713:file-handle-lifecycle:FileHandle.sync",
  ] },
  { file: "src/builder-package.js", owner: "phase-02-plan-17", status: "gated", ids: [
    "src/builder-package.js:268:filesystem-read:fs.lstat",
    "src/builder-package.js:273:filesystem-open:fs.open",
    "src/builder-package.js:274:file-handle-read:FileHandle.stat",
    "src/builder-package.js:277:file-handle-read:FileHandle.stat",
    "src/builder-package.js:278:filesystem-read:fs.lstat",
    "src/builder-package.js:510:filesystem-read:fs.lstat",
    "src/builder-package.js:518:filesystem-read:fs.lstat",
    "src/builder-package.js:541:filesystem-read:fs.realpath",
    "src/builder-package.js:591:filesystem-read:fs.lstat",
    "src/builder-package.js:592:filesystem-read:fs.lstat",
    "src/builder-package.js:593:filesystem-read:fs.lstat",
    "src/builder-package.js:594:filesystem-read:fs.lstat",
    "src/builder-package.js:638:filesystem-read:fs.readdir",
    "src/builder-package.js:639:filesystem-read:fs.lstat",
    "src/builder-package.js:650:filesystem-read:fs.lstat",
    "src/builder-package.js:651:filesystem-read:fs.lstat",
    "src/builder-package.js:652:filesystem-read:fs.lstat",
    "src/builder-package.js:653:filesystem-read:fs.lstat",
    "src/builder-package.js:832:file-handle-read:FileHandle.read",
    "src/builder-package.js:1069:filesystem-read:fs.readdir",
    "src/builder-package.js:1082:filesystem-read:fs.lstat",
    "src/builder-package.js:1083:filesystem-read:fs.realpath",
    "src/builder-package.js:1579:filesystem-read:fs.lstat",
    "src/builder-package.js:1583:filesystem-read:fs.realpath",
    "src/builder-package.js:1594:filesystem-read:fs.lstat",
    "src/builder-package.js:1604:filesystem-read:fs.lstat",
    "src/builder-package.js:1630:filesystem-read:fs.realpath",
    "src/builder-package.js:1685:filesystem-read:fs.lstat",
    "src/builder-package.js:1686:filesystem-read:fs.realpath",
    "src/builder-package.js:1836:filesystem-read:fs.lstat",
    "src/builder-package.js:1919:filesystem-read:fs.lstat",
    "src/builder-package.js:1923:filesystem-read:fs.realpath",
    "src/builder-package.js:1926:filesystem-open:fs.open",
    "src/builder-package.js:1927:file-handle-read:FileHandle.stat",
    "src/builder-package.js:1932:file-handle-read:FileHandle.stat",
    "src/builder-package.js:1933:filesystem-read:fs.lstat",
    "src/builder-package.js:2041:filesystem-read:fs.realpath",
    "src/builder-package.js:2070:filesystem-read:fs.lstat",
    "src/builder-package.js:2071:filesystem-read:fs.realpath",
  ] },
  { file: "src/builder-posix-effect.js", owner: "phase-02-plan-19", status: "gated", ids: [
    "src/builder-posix-effect.js:122:file-handle-read:FileHandle.stat",
    "src/builder-posix-effect.js:123:file-handle-read:FileHandle.readFile",
    "src/builder-posix-effect.js:124:file-handle-read:FileHandle.stat",
    "src/builder-posix-effect.js:140:filesystem-read:fs.lstat",
    "src/builder-posix-effect.js:142:filesystem-read:fs.lstat",
    "src/builder-posix-effect.js:153:filesystem-read:fs.lstat",
    "src/builder-posix-effect.js:154:filesystem-read:fs.lstat",
    "src/builder-posix-effect.js:207:file-handle-read:FileHandle.stat",
    "src/builder-posix-effect.js:225:file-handle-lifecycle:FileHandle.sync",
    "src/builder-posix-effect.js:237:file-handle-lifecycle:FileHandle.sync",
    "src/builder-posix-effect.js:258:file-handle:FileHandle.writeFile",
    "src/builder-posix-effect.js:259:file-handle-lifecycle:FileHandle.sync",
    "src/builder-posix-effect.js:266:file-handle-lifecycle:FileHandle.sync",
    "src/builder-posix-effect.js:278:filesystem-read:fs.lstat",
    "src/builder-posix-effect.js:290:filesystem-read:fs.lstat",
    "src/builder-posix-effect.js:291:filesystem-read:fs.lstat",
    "src/builder-posix-effect.js:307:file-handle-read:FileHandle.readFile",
    "src/builder-posix-effect.js:313:file-handle-lifecycle:FileHandle.sync",
    "src/builder-posix-effect.js:316:file-handle-read:FileHandle.stat",
    "src/builder-posix-effect.js:451:stream-write:stdin.end",
    "src/builder-posix-effect.js:512:file-handle-read:FileHandle.stat",
    "src/builder-posix-effect.js:513:filesystem-read:fs.lstat",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "gated", ids: [
    "src/cli.js:447:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:472:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:477:durable-loader:loadAdmittedArtifact",
    "src/cli.js:560:durable-loader:loadAdmittedArtifact",
    "src/cli.js:565:durable-loader:loadAdmittedArtifact",
    "src/cli.js:591:durable-loader:loadAdmittedArtifact",
    "src/cli.js:596:durable-loader:loadAdmittedArtifact",
    "src/cli.js:602:durable-loader:loadAdmittedArtifact",
    "src/cli.js:631:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:656:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:687:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:699:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:715:durable-loader:loadAdmittedArtifact",
    "src/cli.js:789:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:793:durable-loader:loadAdmittedArtifact",
    "src/cli.js:798:durable-loader:loadAdmittedArtifact",
    "src/cli.js:803:durable-loader:loadAdmittedArtifact",
    "src/cli.js:828:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:832:durable-loader:loadAdmittedArtifact",
    "src/cli.js:851:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:855:durable-loader:loadAdmittedArtifact",
    "src/cli.js:860:durable-loader:loadAdmittedArtifact",
    "src/cli.js:865:durable-loader:loadAdmittedArtifact",
    "src/cli.js:871:durable-loader:loadAdmittedArtifact",
    "src/cli.js:883:durable-loader:loadAdmittedArtifact",
    "src/cli.js:932:durable-loader:loadAdmittedBlueprint",
    "src/cli.js:1884:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1896:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1909:serializer-to-sink:emitPersistableOutput",
    "src/cli.js:1998:process-output:process.stdout.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "non-artifact", ids: [
    "src/cli.js:2002:process-output:process.stdout.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "diagnostic", ids: [
    "src/cli.js:2006:process-output:process.stdout.write",
    "src/cli.js:2010:process-output:process.stderr.write",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "transient-runtime", ids: [
    "src/cli.js:2875:filesystem-read:fs.readFile",
  ] },
  { file: "src/cli.js", owner: "phase-02-plan-20", status: "ephemeral-secret", ids: [
    "src/cli.js:2901:filesystem-read:fs.readFile",
  ] },
]);


// Doctor remediation ownership is independent from aggregate lifecycle health;
// retain the exact diagnostic read surface after that distinction was restored.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  { file: "src/builder-doctor.js", owner: "phase-02-plan-14", status: "diagnostic", ids: [
    "src/builder-doctor.js:837:filesystem-read:fs.lstat",
    "src/builder-doctor.js:906:filesystem-read:fs.realpath",
    "src/builder-doctor.js:907:filesystem-read:fs.lstat",
    "src/builder-doctor.js:981:filesystem-read:fs.lstat",
    "src/builder-doctor.js:987:filesystem-read:fs.realpath",
    "src/builder-doctor.js:991:filesystem-open:fs.open",
    "src/builder-doctor.js:998:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:999:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1011:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1023:filesystem-open:fs.open",
    "src/builder-doctor.js:1027:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1028:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1038:file-handle-read:FileHandle.read",
    "src/builder-doctor.js:1105:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1106:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1120:file-handle-read:FileHandle.stat",
    "src/builder-doctor.js:1121:filesystem-read:fs.lstat",
    "src/builder-doctor.js:1122:filesystem-read:fs.realpath",
  ] },
]);

// Current deep-review source closure. Every row remains exact; this helper only
// removes repeated file prefixes and does not derive allowlisting from the scanner.
function exactModuleSurfaceGroup(file, owner, status, rows) {
  const normalizedRows = rows.trim();
  const ids = normalizedRows.length === 0
    ? []
    : normalizedRows.split("\n").map((row) => `${file}:${row.trim()}`);
  return { file, owner, status, ids };
}

reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  exactModuleSurfaceGroup("scripts/build-builder-uat-releases.js", "phase-02-plan-17", "gated", `
    90:filesystem-read:fs.lstat
    126:filesystem-open:fs.open
    133:file-handle-read:FileHandle.stat
    134:filesystem-read:fs.lstat
    230:file-handle-read:FileHandle.stat
    231:filesystem-read:fs.lstat
    260:filesystem-read:fs.lstat
    261:filesystem-read:fs.lstat
    263:filesystem-read:fs.readFile
    272:filesystem-read:fs.lstat
    273:filesystem-open:fs.open
    274:file-handle-read:FileHandle.stat
    278:file-handle-read:FileHandle.readFile
    282:file-handle-lifecycle:FileHandle.sync
    284:file-handle-read:FileHandle.stat
    285:filesystem-read:fs.lstat
    308:filesystem-open:fs.open
    312:file-handle-read:FileHandle.stat
    318:file-handle-read:FileHandle.readFile
    333:filesystem-open:fs.open
    338:file-handle-read:FileHandle.stat
    339:file-handle-read:FileHandle.stat
    344:file-handle-read:FileHandle.readFile
    347:file-handle-lifecycle:FileHandle.sync
    349:filesystem-read:fs.lstat
    350:filesystem-read:fs.lstat
    351:file-handle-read:FileHandle.stat
    355:filesystem-read:fs.readFile
    356:filesystem-read:fs.readFile
    387:filesystem-read:fs.lstat
    388:filesystem-read:fs.lstat
    390:filesystem-open:fs.open
    391:filesystem-open:fs.open
    396:file-handle-read:FileHandle.stat
    397:file-handle-read:FileHandle.stat
    408:file-handle-read:FileHandle.readFile
    409:file-handle-read:FileHandle.readFile
    412:file-handle-read:FileHandle.stat
    413:file-handle-read:FileHandle.stat
    414:filesystem-read:fs.lstat
    415:filesystem-read:fs.lstat
    488:filesystem-read:fs.readFile
    579:filesystem-read:fs.readdir
    580:filesystem-read:fs.readdir
    639:filesystem-read:fs.readFile
    666:filesystem-read:fs.readFile
    667:filesystem-read:fs.readFile
    790:filesystem-read:fs.readFile
    793:filesystem-read:fs.readFile
    840:filesystem-read:fs.readFile
    857:filesystem-read:fs.realpath
    910:managed-writer:channel.write
  `),
  exactModuleSurfaceGroup("scripts/preflight-codex-uat-prior-attempt.js", "phase-02-plan-23", "diagnostic", `
    85:managed-writer:output.write
    89:managed-writer:errorOutput.write
    155:process-output:process.stderr.write
  `),
  exactModuleSurfaceGroup("scripts/preflight-codex-uat-prior-attempt.js", "phase-02-plan-23", "ephemeral-secret", `
    45:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("scripts/preflight-codex-uat-prior-attempt.js", "phase-02-plan-23", "gated", `
    142:filesystem-read:fs.realpath
    143:filesystem-read:fs.realpath
  `),
exactModuleSurfaceGroup("src/builder-append-only-authority.js", "phase-02-plan-19", "gated", `
    1133:filesystem-read:fs.realpath
    1137:filesystem-read:fs.lstat
    1841:filesystem-read:fs.lstat
    1986:filesystem-read:fs.lstat
    1987:filesystem-read:fs.readlink
    1988:filesystem-read:fs.lstat
    2010:filesystem-read:fs.readlink
    2024:filesystem-read:fs.readlink
    2050:filesystem-read:fs.lstat
    2062:filesystem-read:fs.lstat
    2142:file-handle-read:FileHandle.stat
    2151:filesystem-open:fs.open
    2152:file-handle-read:FileHandle.stat
    2159:file-handle-read:FileHandle.readFile
    2160:file-handle-read:FileHandle.stat
    2182:filesystem-open:fs.open
    2183:file-handle-read:FileHandle.stat
    2187:file-handle-read:FileHandle.readFile
    2188:file-handle-read:FileHandle.stat
    2240:filesystem-read:fs.lstat
    2253:filesystem-read:fs.readdir
    2274:filesystem-read:fs.lstat
    2280:filesystem-open:fs.open
    2284:file-handle-read:FileHandle.stat
    2285:filesystem-read:fs.lstat
    2314:file-handle-read:FileHandle.stat
    2315:filesystem-read:fs.lstat
    2324:filesystem-read:fs.lstat
    2391:filesystem-read:fs.readdir
    2401:file-handle-lifecycle:FileHandle.sync
  `),
  exactModuleSurfaceGroup("src/builder-behavior-eval.js", "phase-02-plan-15", "gated", `
    145:filesystem-lifecycle:fs.mkdtemp
    148:filesystem-lifecycle:fs.mkdir
    1012:stream-write:stdin.end
    1131:stream-write:stdin.end
  `),
  exactModuleSurfaceGroup("src/builder-behavior-eval.js", "phase-02-plan-15", "transient-runtime", `
    759:filesystem-lifecycle:fs.mkdir
    760:filesystem-lifecycle:fs.mkdir
    761:filesystem-lifecycle:fs.mkdir
    774:filesystem-lifecycle:fs.mkdir
    775:filesystem:fs.writeFile
    782:filesystem-lifecycle:fs.mkdir
    783:filesystem:fs.writeFile
  `),
exactModuleSurfaceGroup("src/builder-checkpoint.js", "phase-02-plan-15", "gated", `
    787:filesystem-read:fs.realpath
    788:filesystem-read:fs.lstat
    817:filesystem-read:fs.realpath
    818:filesystem-read:fs.lstat
    841:filesystem-read:fs.realpath
    842:filesystem-read:fs.realpath
    986:filesystem-read:fs.realpath
  `),
  exactModuleSurfaceGroup("src/builder-codex-host.js", "phase-02-plan-19", "gated", `
    414:filesystem-open:fs.open
    1143:filesystem-read:fs.readdir
    1144:filesystem-read:fs.readdir
    1189:filesystem-read:fs.lstat
    1191:filesystem-open:fs.open
    1192:file-handle-read:FileHandle.stat
    1193:file-handle-read:FileHandle.readFile
    1194:file-handle-read:FileHandle.stat
    1195:filesystem-read:fs.lstat
    1231:filesystem-read:fs.lstat
    1233:filesystem-open:fs.open
    1234:file-handle-read:FileHandle.stat
    1235:file-handle-read:FileHandle.readFile
    1236:file-handle-read:FileHandle.stat
    1237:filesystem-read:fs.lstat
    1274:filesystem-open:fs.open
    1280:file-handle-read:FileHandle.stat
    1281:filesystem-read:fs.lstat
    1307:file-handle-read:FileHandle.stat
    1308:filesystem-read:fs.lstat
    1662:filesystem-read:fs.lstat
    1664:filesystem-open:fs.open
    1665:file-handle-read:FileHandle.stat
    1666:file-handle-read:FileHandle.readFile
    1667:file-handle-read:FileHandle.stat
    1668:filesystem-read:fs.lstat
    1932:stream-write:stdin.end
    2033:managed-writer:stdin.write
    2060:managed-writer:stdin.write
    2305:filesystem-read:fs.lstat
    2306:filesystem-read:fs.lstat
    2310:filesystem-read:fs.realpath
    2311:filesystem-read:fs.realpath
    2321:filesystem-read:fs.lstat
    2329:filesystem-read:fs.readdir
    2335:filesystem-read:fs.lstat
    2344:filesystem-open:fs.open
    2346:file-handle-read:FileHandle.stat
    2347:file-handle-read:FileHandle.readFile
    2348:file-handle-read:FileHandle.stat
    2349:filesystem-read:fs.lstat
    2368:filesystem-read:fs.lstat
    2690:filesystem-open:fs.open
    2705:file-handle-read:FileHandle.stat
    2766:file-handle-read:FileHandle.stat
    2770:file-handle-read:FileHandle.stat
    2771:filesystem-read:fs.lstat
    2802:filesystem-read:fs.lstat
    2838:filesystem-read:fs.opendir
    2915:filesystem-open:fs.open
    2921:file-handle-read:FileHandle.stat
    2928:file-handle-read:FileHandle.readFile
    2929:file-handle-read:FileHandle.stat
    2930:filesystem-read:fs.lstat
    2995:file-handle-read:FileHandle.stat
    3023:file-handle-read:FileHandle.read
    3173:filesystem-read:fs.lstat
    3175:filesystem-read:fs.realpath
  `),
  exactModuleSurfaceGroup("src/builder-codex-uat-continuation.js", "phase-02-plan-22", "gated", `
    240:filesystem-read:fs.realpath
    1191:file-handle-read:FileHandle.stat
    1192:filesystem-read:fs.lstat
    1211:filesystem-read:fs.lstat
    1393:filesystem-read:fs.realpath
    1451:filesystem-open:fs.open
    1452:file-handle-read:FileHandle.stat
    1453:filesystem-read:fs.lstat
    1461:file-handle-read:FileHandle.stat
    1462:filesystem-read:fs.lstat
    1475:filesystem-open:fs.open
    1479:file-handle-read:FileHandle.stat
    1480:filesystem-read:fs.lstat
    1491:file-handle-read:FileHandle.stat
    1493:filesystem-read:fs.lstat
    1503:file-handle-read:FileHandle.stat
    1504:filesystem-read:fs.lstat
    1510:filesystem-read:fs.lstat
    1585:file-handle-read:FileHandle.read
  `),
  exactModuleSurfaceGroup("src/builder-codex-uat-private-authority.js", "phase-02-plan-23", "gated", `
    237:filesystem-read:fs.lstat
    239:file-handle-lifecycle:FileHandle.sync
    584:filesystem-read:fs.realpath
    586:filesystem-read:fs.lstat
    598:filesystem-read:fs.realpath
    599:filesystem-read:fs.lstat
    613:filesystem-read:fs.lstat
    615:filesystem-read:fs.realpath
    618:filesystem-open:fs.open
    619:file-handle-read:FileHandle.stat
    620:filesystem-read:fs.lstat
    634:filesystem-read:fs.lstat
    636:filesystem-open:fs.open
    637:file-handle-read:FileHandle.stat
    638:filesystem-read:fs.lstat
    650:file-handle-read:FileHandle.stat
    651:filesystem-read:fs.lstat
    685:file-handle-read:FileHandle.stat
    686:filesystem-read:fs.lstat
    849:filesystem-read:fs.readdir
    945:file-handle-read:FileHandle.read
  `),
  exactModuleSurfaceGroup("src/builder-codex-uat.js", "phase-02-plan-22", "gated", `
    1821:filesystem-read:fs.lstat
    1827:filesystem-read:fs.realpath
    1828:filesystem-read:fs.lstat
    1882:filesystem-read:fs.lstat
    1889:filesystem-open:fs.open
    1893:file-handle-read:FileHandle.stat
    1894:filesystem-read:fs.lstat
    1907:filesystem-read:fs.lstat
    1936:filesystem-read:fs.lstat
    1959:filesystem-read:fs.realpath
    2033:file-handle-lifecycle:FileHandle.sync
    2038:file-handle-lifecycle:FileHandle.sync
    2060:filesystem-read:fs.lstat
    2091:file-handle-read:FileHandle.stat
    2092:filesystem-read:fs.lstat
    2102:filesystem-read:fs.lstat
    2154:filesystem-open:fs.open
    2155:file-handle-read:FileHandle.stat
    2156:filesystem-read:fs.lstat
    2174:file-handle-read:FileHandle.stat
    2175:filesystem-read:fs.lstat
    2190:file-handle-read:FileHandle.stat
    2211:filesystem-read:fs.lstat
    2218:filesystem-read:fs.lstat
    2224:filesystem-read:fs.readdir
    2232:filesystem-read:fs.lstat
    2239:filesystem-open:fs.open
    2243:file-handle-read:FileHandle.stat
    2244:filesystem-read:fs.lstat
    2262:filesystem-read:fs.lstat
    2272:filesystem-read:fs.readdir
    2399:file-handle-read:FileHandle.read
  `),
  exactModuleSurfaceGroup("src/builder-doctor.js", "phase-02-plan-14", "diagnostic", `
    885:filesystem-read:fs.lstat
    965:filesystem-read:fs.realpath
    966:filesystem-read:fs.lstat
    997:filesystem-read:fs.lstat
    1003:filesystem-read:fs.realpath
    1007:filesystem-open:fs.open
    1014:file-handle-read:FileHandle.stat
    1015:filesystem-read:fs.lstat
    1027:filesystem-read:fs.lstat
    1038:filesystem-open:fs.open
    1042:file-handle-read:FileHandle.stat
    1043:filesystem-read:fs.lstat
    1052:file-handle-read:FileHandle.read
    1111:file-handle-read:FileHandle.stat
    1112:filesystem-read:fs.lstat
    1126:file-handle-read:FileHandle.stat
    1127:filesystem-read:fs.lstat
    1128:filesystem-read:fs.realpath
  `),
  exactModuleSurfaceGroup("src/builder-immutable-journal.js", "phase-02-plan-21", "gated", `
    449:filesystem-read:fs.lstat
    485:filesystem-read:fs.lstat
    487:filesystem-open:fs.open
    491:file-handle-read:FileHandle.stat
    492:filesystem-read:fs.lstat
    496:file-handle-lifecycle:FileHandle.sync
    512:filesystem-read:fs.readdir
    875:file-handle-lifecycle:FileHandle.sync
    1009:filesystem-open:fs.open
    1015:file-handle-read:FileHandle.read
    1032:file-handle-read:FileHandle.stat
    1033:filesystem-read:fs.lstat
    1046:file-handle-read:FileHandle.stat
    1047:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/builder-install.js", "phase-02-plan-20", "gated", `
    1171:filesystem-read:fs.lstat
    1252:filesystem-open:fs.open
    1253:file-handle-read:FileHandle.stat
    1254:filesystem-read:fs.lstat
    1265:file-handle-read:FileHandle.stat
    1266:filesystem-read:fs.lstat
    2747:filesystem-read:fs.realpath
    2748:filesystem-read:fs.lstat
    2760:filesystem-read:fs.realpath
    2761:filesystem-read:fs.lstat
    2779:filesystem-read:fs.realpath
    2780:filesystem-read:fs.lstat
    2966:filesystem-read:fs.lstat
    2967:filesystem-read:fs.lstat
    3036:filesystem-open:fs.open
    3037:file-handle-read:FileHandle.stat
    3038:filesystem-read:fs.lstat
    3058:filesystem-read:fs.lstat
    3097:filesystem-read:fs.readdir
    3100:filesystem-read:fs.lstat
    3132:filesystem-read:fs.lstat
    3151:filesystem-read:fs.lstat
    3155:filesystem-read:fs.realpath
    3242:filesystem-read:fs.realpath
    3243:filesystem-read:fs.lstat
    3270:filesystem-read:fs.lstat
    3274:filesystem-read:fs.realpath
    3327:filesystem-read:fs.lstat
    3329:filesystem-read:fs.realpath
    3340:filesystem-read:fs.lstat
    3344:filesystem-read:fs.realpath
    3372:filesystem-open:fs.open
    3412:filesystem-open:fs.open
    3416:file-handle-read:FileHandle.stat
    3470:filesystem-read:fs.lstat
    3471:file-handle-read:FileHandle.stat
    3515:filesystem-read:fs.lstat
    3538:filesystem-open:fs.open
    3542:file-handle-read:FileHandle.stat
    3543:filesystem-read:fs.lstat
    3574:file-handle-read:FileHandle.stat
    3575:filesystem-read:fs.lstat
    3585:file-handle-read:FileHandle.stat
    3586:filesystem-read:fs.lstat
    3603:file-handle-read:FileHandle.stat
    3604:filesystem-read:fs.lstat
    3605:filesystem-read:fs.lstat
    3717:file-handle-read:FileHandle.read
  `),
exactModuleSurfaceGroup("src/builder-lifecycle.js", "phase-02-plan-13", "gated", `
    800:filesystem-open:fs.open
    1020:filesystem-open:fs.open
    1021:file-handle-read:FileHandle.stat
    1026:file-handle-read:FileHandle.readFile
    1027:file-handle-read:FileHandle.stat
    1181:filesystem-read:fs.lstat
    1202:filesystem-read:fs.lstat
    1227:filesystem-open:fs.open
    1228:file-handle-read:FileHandle.stat
    1233:file-handle-read:FileHandle.readFile
    1234:file-handle-read:FileHandle.stat
    1254:file-handle-read:FileHandle.stat
    1255:filesystem-read:fs.lstat
    1265:file-handle-read:FileHandle.readFile
    1266:file-handle-read:FileHandle.stat
    1267:filesystem-read:fs.lstat
    1279:filesystem-read:fs.lstat
    1280:filesystem-open:fs.open
    1284:file-handle-read:FileHandle.stat
    1285:filesystem-read:fs.lstat
    2253:filesystem-read:fs.lstat
    2276:filesystem-read:fs.lstat
    2277:filesystem-read:fs.realpath
    2280:filesystem-read:fs.readdir
    2300:filesystem-read:fs.lstat
    2301:filesystem-read:fs.realpath
    2302:filesystem-read:fs.readdir
    2308:filesystem-read:fs.lstat
    2320:filesystem-read:fs.lstat
    2321:filesystem-read:fs.realpath
    2341:filesystem-read:fs.readdir
    2367:filesystem-read:fs.lstat
    2399:filesystem-open:fs.open
    2400:file-handle-read:FileHandle.stat
    2407:file-handle-read:FileHandle.stat
    2408:filesystem-read:fs.lstat
    2444:filesystem-read:fs.lstat
    2556:filesystem-read:fs.lstat
    2558:filesystem-read:fs.realpath
    2586:filesystem-read:fs.lstat
    2592:filesystem-read:fs.realpath
    2748:file-handle-read:FileHandle.read
    2766:filesystem-read:fs.realpath
    2767:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/builder-package.js", "phase-02-plan-17", "gated", `
    278:filesystem-read:fs.lstat
    283:filesystem-open:fs.open
    284:file-handle-read:FileHandle.stat
    287:file-handle-read:FileHandle.stat
    288:filesystem-read:fs.lstat
    592:filesystem-read:fs.lstat
    600:filesystem-read:fs.lstat
    623:filesystem-read:fs.realpath
    671:filesystem-read:fs.lstat
    672:filesystem-read:fs.lstat
    703:filesystem-read:fs.readdir
    704:filesystem-read:fs.lstat
    711:filesystem-read:fs.lstat
    712:filesystem-read:fs.lstat
    891:file-handle-read:FileHandle.read
    1169:filesystem-read:fs.readdir
    1182:filesystem-read:fs.lstat
    1183:filesystem-read:fs.realpath
    1708:filesystem-read:fs.lstat
    1712:filesystem-read:fs.realpath
    1723:filesystem-read:fs.lstat
    1733:filesystem-read:fs.lstat
    1759:filesystem-read:fs.realpath
    1818:filesystem-read:fs.lstat
    1819:filesystem-read:fs.realpath
    2013:filesystem-read:fs.lstat
    2099:filesystem-read:fs.lstat
    2103:filesystem-read:fs.realpath
    2106:filesystem-open:fs.open
    2107:file-handle-read:FileHandle.stat
    2112:file-handle-read:FileHandle.stat
    2113:filesystem-read:fs.lstat
    2233:filesystem-read:fs.realpath
    2262:filesystem-read:fs.lstat
    2263:filesystem-read:fs.realpath
  `),
  exactModuleSurfaceGroup("src/builder-posix-effect.js", "phase-02-plan-19", "gated", `
    196:file-handle-read:FileHandle.stat
    197:file-handle-read:FileHandle.readFile
    198:file-handle-read:FileHandle.stat
    211:file-handle-read:FileHandle.stat
    217:file-handle-read:FileHandle.stat
    225:file-handle:FileHandle.write
    233:file-handle-lifecycle:FileHandle.sync
    234:file-handle-read:FileHandle.stat
    247:filesystem-read:fs.lstat
    249:filesystem-read:fs.lstat
    260:filesystem-read:fs.lstat
    261:filesystem-read:fs.lstat
    294:file-handle-read:FileHandle.stat
    369:file-handle-read:FileHandle.stat
    421:file-handle-lifecycle:FileHandle.sync
    432:file-handle-lifecycle:FileHandle.sync
    468:file-handle:FileHandle.writeFile
    469:file-handle-lifecycle:FileHandle.sync
    480:file-handle-read:FileHandle.stat
    492:file-handle-read:FileHandle.read
    501:file-handle-read:FileHandle.stat
    506:file-handle-lifecycle:FileHandle.sync
    527:file-handle-lifecycle:FileHandle.sync
    537:file-handle-read:FileHandle.stat
    538:file-handle-read:FileHandle.readFile
    539:file-handle-read:FileHandle.stat
    565:filesystem-read:fs.lstat
    577:file-handle-read:FileHandle.stat
    578:filesystem-read:fs.lstat
    579:filesystem-read:fs.lstat
    596:file-handle-read:FileHandle.readFile
    597:file-handle-read:FileHandle.stat
    613:file-handle-lifecycle:FileHandle.sync
    620:file-handle-read:FileHandle.stat
    809:stream-write:stdin.end
    927:file-handle-read:FileHandle.stat
    928:filesystem-read:fs.lstat
    944:filesystem-read:fs.lstat
    960:file-handle-read:FileHandle.stat
    973:file-handle-read:FileHandle.stat
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "diagnostic", `
    2128:process-output:process.stdout.write
    2132:process-output:process.stderr.write
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "ephemeral-secret", `
    3039:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "gated", `
    503:durable-loader:loadAdmittedBlueprint
    528:durable-loader:loadAdmittedBlueprint
    533:durable-loader:loadAdmittedArtifact
    616:durable-loader:loadAdmittedArtifact
    621:durable-loader:loadAdmittedArtifact
    647:durable-loader:loadAdmittedArtifact
    652:durable-loader:loadAdmittedArtifact
    658:durable-loader:loadAdmittedArtifact
    687:durable-loader:loadAdmittedBlueprint
    712:durable-loader:loadAdmittedBlueprint
    743:durable-loader:loadAdmittedBlueprint
    755:durable-loader:loadAdmittedBlueprint
    771:durable-loader:loadAdmittedArtifact
    845:durable-loader:loadAdmittedBlueprint
    849:durable-loader:loadAdmittedArtifact
    854:durable-loader:loadAdmittedArtifact
    859:durable-loader:loadAdmittedArtifact
    884:durable-loader:loadAdmittedBlueprint
    888:durable-loader:loadAdmittedArtifact
    907:durable-loader:loadAdmittedBlueprint
    911:durable-loader:loadAdmittedArtifact
    916:durable-loader:loadAdmittedArtifact
    921:durable-loader:loadAdmittedArtifact
    927:durable-loader:loadAdmittedArtifact
    939:durable-loader:loadAdmittedArtifact
    988:durable-loader:loadAdmittedBlueprint
    1981:serializer-to-sink:emitPersistableOutput
    1993:serializer-to-sink:emitPersistableOutput
    2006:serializer-to-sink:emitPersistableOutput
    2120:process-output:process.stdout.write
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "non-artifact", `
    2124:process-output:process.stdout.write
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "transient-runtime", `
    3013:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/migration-filesystem.js", "phase-01.1-plan-05", "gated", `
    800:file-handle:FileHandle.write
  `),
  exactModuleSurfaceGroup("src/migration-filesystem.js", "phase-01.1-plan-13", "gated", `
    217:filesystem-lifecycle:fs.mkdir
    227:filesystem-read:fs.lstat
    230:filesystem-open:fs.open
    240:file-handle-lifecycle:FileHandle.sync
    265:file-handle-lifecycle:FileHandle.sync
    306:managed-filesystem:directoryHandle.chmod
    358:filesystem-open:fs.open
    359:file-handle-read:FileHandle.stat
    409:filesystem-read:fs.readdir
    441:filesystem-read:fs.lstat
    449:filesystem-open:fs.open
    450:file-handle-read:FileHandle.stat
    451:filesystem-read:fs.lstat
    462:file-handle-lifecycle:FileHandle.sync
    466:filesystem-read:fs.lstat
    519:file-handle-read:FileHandle.stat
    520:filesystem-read:fs.lstat
    543:file-handle-read:FileHandle.stat
    544:filesystem-read:fs.lstat
    578:filesystem-read:fs.lstat
    582:filesystem-open:fs.open
    583:file-handle-read:FileHandle.stat
    584:filesystem-read:fs.lstat
    606:filesystem-read:fs.lstat
    608:filesystem-open:fs.open
    609:file-handle-read:FileHandle.stat
    615:file-handle-lifecycle:FileHandle.sync
    619:filesystem-read:fs.lstat
    690:filesystem-read:fs.lstat
    694:filesystem-open:fs.open
    695:file-handle-read:FileHandle.stat
    696:filesystem-read:fs.lstat
    706:filesystem-read:fs.lstat
    709:filesystem-open:fs.open
    710:file-handle-read:FileHandle.stat
    715:file-handle-read:FileHandle.stat
    716:filesystem-read:fs.lstat
    717:file-handle-read:FileHandle.stat
    718:filesystem-read:fs.lstat
    751:filesystem-open:fs.open
    780:file-handle-lifecycle:FileHandle.sync
    797:file-handle-lifecycle:FileHandle.truncate
    811:file-handle-lifecycle:FileHandle.truncate
    817:file-handle-lifecycle:FileHandle.sync
    820:file-handle-lifecycle:FileHandle.truncate
    834:file-handle-read:FileHandle.stat
    835:filesystem-read:fs.lstat
    883:filesystem-open:fs.open
    898:file-handle-read:FileHandle.read
    1112:filesystem-read:fs.lstat
  `),
]);

// Bootstrap release delivery is a parent-owned, exact-length pipe frame from
// retained, digest-verified bytes. It creates no snapshot paths; the bridge
// interprets only the declared frame and never claims to inspect later bytes.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  exactModuleSurfaceGroup("plugin/hooks/agentmo-hook.js", "phase-02-plan-17", "gated", `
    209:filesystem-read:fs.lstat
    211:filesystem-read:fs.realpath
    224:filesystem-read:fs.realpath
    226:filesystem-read:fs.lstat
    227:filesystem-read:fs.lstat
    228:filesystem-read:fs.realpath
    324:filesystem-read:fs.lstat
    325:filesystem-read:fs.realpath
    336:filesystem-read:fs.lstat
    337:filesystem-read:fs.realpath
    341:filesystem-open:fs.open
    342:file-handle-read:FileHandle.stat
    345:file-handle-read:FileHandle.stat
    346:filesystem-read:fs.lstat
    417:filesystem-read:fs.lstat
    419:filesystem-read:fs.realpath
    422:filesystem-open:fs.open
    423:file-handle-read:FileHandle.stat
    426:filesystem-read:fs.lstat
    435:file-handle-read:FileHandle.stat
    437:file-handle-read:FileHandle.readFile
    658:filesystem-read:fs.lstat
    660:filesystem-open:fs.open
    664:file-handle-read:FileHandle.stat
    665:filesystem-read:fs.lstat
    691:filesystem-read:fs.lstat
    707:file-handle-read:FileHandle.stat
    708:filesystem-read:fs.lstat
    716:filesystem-read:fs.lstat
    780:filesystem-read:fs.readdir
    804:filesystem-read:fs.lstat
    816:filesystem-read:fs.lstat
    817:filesystem-read:fs.readlink
    818:filesystem-read:fs.lstat
    1927:process-spawn:child_process.spawn
    2025:stream-write:stdin.end
    2026:stream-write:null.end
    2027:stream-write:null.end
    2133:process-output:process.stdout.write
  `),
  exactModuleSurfaceGroup("src/builder-bootstrap-snapshot.js", "phase-02-plan-17", "gated", `
    122:filesystem-read:fs.fstatSync
    163:filesystem-read:fs.read
  `),
  exactModuleSurfaceGroup("src/builder-hook-bridge.js", "phase-02-plan-17", "gated", ``),
  exactModuleSurfaceGroup("src/builder-lifecycle.js", "phase-02-plan-13", "gated", `
    819:filesystem-open:fs.open
    1039:filesystem-open:fs.open
    1040:file-handle-read:FileHandle.stat
    1045:file-handle-read:FileHandle.readFile
    1046:file-handle-read:FileHandle.stat
    1200:filesystem-read:fs.lstat
    1221:filesystem-read:fs.lstat
    1246:filesystem-open:fs.open
    1247:file-handle-read:FileHandle.stat
    1252:file-handle-read:FileHandle.readFile
    1253:file-handle-read:FileHandle.stat
    1273:file-handle-read:FileHandle.stat
    1274:filesystem-read:fs.lstat
    1284:file-handle-read:FileHandle.readFile
    1285:file-handle-read:FileHandle.stat
    1286:filesystem-read:fs.lstat
    1298:filesystem-read:fs.lstat
    1299:filesystem-open:fs.open
    1303:file-handle-read:FileHandle.stat
    1304:filesystem-read:fs.lstat
    2273:filesystem-read:fs.lstat
    2296:filesystem-read:fs.lstat
    2297:filesystem-read:fs.realpath
    2300:filesystem-read:fs.readdir
    2320:filesystem-read:fs.lstat
    2321:filesystem-read:fs.realpath
    2322:filesystem-read:fs.readdir
    2328:filesystem-read:fs.lstat
    2340:filesystem-read:fs.lstat
    2341:filesystem-read:fs.realpath
    2361:filesystem-read:fs.readdir
    2387:filesystem-read:fs.lstat
    2419:filesystem-open:fs.open
    2420:file-handle-read:FileHandle.stat
    2427:file-handle-read:FileHandle.stat
    2428:filesystem-read:fs.lstat
    2470:filesystem-read:fs.lstat
    2596:filesystem-read:fs.lstat
    2598:filesystem-read:fs.realpath
    2626:filesystem-read:fs.lstat
    2632:filesystem-read:fs.realpath
    2788:file-handle-read:FileHandle.read
    2806:filesystem-read:fs.realpath
    2807:filesystem-read:fs.lstat
  `),
exactModuleSurfaceGroup("src/builder-package.js", "phase-02-plan-17", "gated", `
    342:filesystem-read:fs.lstat
    347:filesystem-open:fs.open
    348:file-handle-read:FileHandle.stat
    351:file-handle-read:FileHandle.stat
    352:filesystem-read:fs.lstat
    656:filesystem-read:fs.lstat
    664:filesystem-read:fs.lstat
    687:filesystem-read:fs.realpath
    735:filesystem-read:fs.lstat
    736:filesystem-read:fs.lstat
    767:filesystem-read:fs.readdir
    768:filesystem-read:fs.lstat
    775:filesystem-read:fs.lstat
    776:filesystem-read:fs.lstat
    955:file-handle-read:FileHandle.read
    1279:filesystem-read:fs.readdir
    1292:filesystem-read:fs.lstat
    1293:filesystem-read:fs.realpath
    2016:filesystem-read:fs.lstat
    2020:filesystem-read:fs.realpath
    2031:filesystem-read:fs.lstat
    2041:filesystem-read:fs.lstat
    2067:filesystem-read:fs.realpath
    2126:filesystem-read:fs.lstat
    2127:filesystem-read:fs.realpath
    2379:filesystem-read:fs.lstat
    2465:filesystem-read:fs.lstat
    2469:filesystem-read:fs.realpath
    2472:filesystem-open:fs.open
    2473:file-handle-read:FileHandle.stat
    2478:file-handle-read:FileHandle.stat
    2479:filesystem-read:fs.lstat
    2599:filesystem-read:fs.realpath
    2628:filesystem-read:fs.lstat
    2629:filesystem-read:fs.realpath
  `),
]);

// Phase 03 live discovery adds one bounded network intake and one whole-set
// publication boundary. Reconcile exact line-addressed surfaces after the CLI
// gains its public command branch.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  exactModuleSurfaceGroup("src/cli.js", "phase-03-plan-05", "gated", `
    538:durable-loader:loadAdmittedBlueprint
    563:durable-loader:loadAdmittedBlueprint
    568:durable-loader:loadAdmittedArtifact
    656:durable-loader:loadAdmittedArtifact
    661:durable-loader:loadAdmittedArtifact
    729:durable-loader:loadAdmittedArtifact
    754:durable-loader:loadAdmittedArtifact
    759:durable-loader:loadAdmittedArtifact
    764:durable-loader:loadAdmittedArtifact
    769:durable-loader:loadAdmittedArtifact
    809:durable-loader:loadAdmittedArtifact
    814:durable-loader:loadAdmittedArtifact
    820:durable-loader:loadAdmittedArtifact
    849:durable-loader:loadAdmittedBlueprint
    853:durable-loader:loadAdmittedArtifact
    858:durable-loader:loadAdmittedArtifact
    868:durable-loader:loadAdmittedArtifact
    934:durable-loader:loadAdmittedBlueprint
    938:durable-loader:loadAdmittedArtifact
    943:durable-loader:loadAdmittedArtifact
    948:durable-loader:loadAdmittedArtifact
    989:durable-loader:loadAdmittedBlueprint
    993:durable-loader:loadAdmittedArtifact
    1037:durable-loader:loadAdmittedBlueprint
    1062:durable-loader:loadAdmittedBlueprint
    1093:durable-loader:loadAdmittedBlueprint
    1105:durable-loader:loadAdmittedBlueprint
    1121:durable-loader:loadAdmittedArtifact
    1195:durable-loader:loadAdmittedBlueprint
    1199:durable-loader:loadAdmittedArtifact
    1204:durable-loader:loadAdmittedArtifact
    1209:durable-loader:loadAdmittedArtifact
    1234:durable-loader:loadAdmittedBlueprint
    1238:durable-loader:loadAdmittedArtifact
    1257:durable-loader:loadAdmittedBlueprint
    1261:durable-loader:loadAdmittedArtifact
    1266:durable-loader:loadAdmittedArtifact
    1271:durable-loader:loadAdmittedArtifact
    1277:durable-loader:loadAdmittedArtifact
    1289:durable-loader:loadAdmittedArtifact
    1338:durable-loader:loadAdmittedBlueprint
    2331:serializer-to-sink:emitPersistableOutput
    2343:serializer-to-sink:emitPersistableOutput
    2356:serializer-to-sink:emitPersistableOutput
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "non-artifact", `
    2470:process-output:process.stdout.write
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "diagnostic", `
    2474:process-output:process.stdout.write
    2478:process-output:process.stdout.write
    2482:process-output:process.stderr.write
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "transient-runtime", `
    3792:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "ephemeral-secret", `
    3818:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/artifact-admission.js", "phase-03-plan-03", "gated", `
    508:filesystem-open:file.openInput
    509:file-handle-read:FileHandle.stat
    519:file-handle-read:FileHandle.read
    531:file-handle-read:FileHandle.stat
  `),
  exactModuleSurfaceGroup("src/build-contract.js", "phase-03-plan-05", "gated", `
    309:durable-loader:loadAdmittedArtifact
    418:managed-writer:persistability.writePersistableJsonAtomic
  `),
  exactModuleSurfaceGroup("src/openclaw-target-admission.js", "phase-04-plan-17", "gated", `
    311:filesystem-open:fs.open
    312:file-handle-read:FileHandle.stat
    313:file-handle:FileHandle.writeFile
    314:file-handle-lifecycle:FileHandle.sync
    317:filesystem-read:fs.lstat
    405:filesystem-read:fs.lstat
    454:filesystem-read:fs.lstat
    456:filesystem-open:fs.open
    460:file-handle-read:FileHandle.stat
    461:file-handle-read:FileHandle.readFile
    462:file-handle-read:FileHandle.stat
    463:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/openclaw-target-descriptor.js", "phase-04-plan-17", "gated", `
    296:filesystem-open:fs.open
    297:file-handle-read:FileHandle.stat
    298:file-handle:FileHandle.writeFile
    299:file-handle-lifecycle:FileHandle.sync
    302:filesystem-read:fs.lstat
    396:filesystem-read:fs.lstat
    435:filesystem-read:fs.lstat
    441:filesystem-open:fs.open
    445:file-handle-read:FileHandle.stat
    446:file-handle-read:FileHandle.readFile
    447:file-handle-read:FileHandle.stat
    448:filesystem-read:fs.lstat
    534:filesystem-read:fs.lstat
    536:filesystem-open:fs.open
    540:file-handle-read:FileHandle.stat
    541:file-handle-read:FileHandle.readFile
    542:file-handle-read:FileHandle.stat
    543:filesystem-read:fs.lstat
    568:filesystem-read:fs.lstat
    589:filesystem-read:fs.lstat
    597:filesystem-open:fs.open
    601:file-handle-read:FileHandle.stat
    607:file-handle-read:FileHandle.readFile
    608:file-handle-read:FileHandle.stat
    609:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/plan-approval.js", "phase-03-plan-05", "gated", `
    146:filesystem-open:fs.open
    148:file-handle:FileHandle.writeFile
    149:file-handle-lifecycle:FileHandle.sync
    153:filesystem-lifecycle:fs.unlink
  `),
  exactModuleSurfaceGroup("src/design-plan.js", "phase-03-plan-03", "gated", `
    63:durable-loader:loadAdmittedArtifact
    243:managed-writer:persistability.writePersistableJsonAtomic
  `),
  exactModuleSurfaceGroup("src/discovery-approval.js", "phase-03-plan-03", "gated", `
    152:filesystem-open:fs.open
    154:file-handle:FileHandle.writeFile
    155:file-handle-lifecycle:FileHandle.sync
    159:filesystem-lifecycle:fs.unlink
  `),
  exactModuleSurfaceGroup("src/discovery.js", "phase-01.1-plan-03", "gated", `
    21:durable-loader:loadAdmittedArtifact
  `),
  exactModuleSurfaceGroup("src/discovery-live-transport.js", "phase-03-plan-01", "non-artifact-intake", `
    130:stream-write:req.end
  `),
  exactModuleSurfaceGroup("src/discovery-live.js", "phase-03-plan-01", "gated", `
    159:managed-filesystem:publicationIo.mkdir
    160:managed-filesystem:publicationIo.mkdir
    162:managed-writer:publicationIo.writeFile
    169:managed-filesystem:publicationIo.rename
    631:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/discovery-provenance.js", "phase-03-plan-01", "gated", ``),
]);

// Phase 04 closes the exact package and lifecycle surface. This remains a
// line-addressed inventory: new methods or shifted calls fail until reviewed.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  exactModuleSurfaceGroup("src/builder-package.js", "phase-02-plan-17", "gated", `
    348:filesystem-read:fs.lstat
    353:filesystem-open:fs.open
    354:file-handle-read:FileHandle.stat
    357:file-handle-read:FileHandle.stat
    358:filesystem-read:fs.lstat
    666:filesystem-read:fs.lstat
    674:filesystem-read:fs.lstat
    697:filesystem-read:fs.realpath
    745:filesystem-read:fs.lstat
    746:filesystem-read:fs.lstat
    777:filesystem-read:fs.readdir
    778:filesystem-read:fs.lstat
    785:filesystem-read:fs.lstat
    786:filesystem-read:fs.lstat
    965:file-handle-read:FileHandle.read
    1329:filesystem-read:fs.readdir
    1342:filesystem-read:fs.lstat
    1343:filesystem-read:fs.realpath
    2067:filesystem-read:fs.lstat
    2071:filesystem-read:fs.realpath
    2082:filesystem-read:fs.lstat
    2092:filesystem-read:fs.lstat
    2118:filesystem-read:fs.realpath
    2177:filesystem-read:fs.lstat
    2178:filesystem-read:fs.realpath
    2430:filesystem-read:fs.lstat
    2516:filesystem-read:fs.lstat
    2520:filesystem-read:fs.realpath
    2523:filesystem-open:fs.open
    2524:file-handle-read:FileHandle.stat
    2529:file-handle-read:FileHandle.stat
    2530:filesystem-read:fs.lstat
    2650:filesystem-read:fs.realpath
    2679:filesystem-read:fs.lstat
    2680:filesystem-read:fs.realpath
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-03-plan-05", "gated", `
    623:durable-loader:loadAdmittedBlueprint
    648:durable-loader:loadAdmittedBlueprint
    653:durable-loader:loadAdmittedArtifact
    741:durable-loader:loadAdmittedArtifact
    746:durable-loader:loadAdmittedArtifact
    770:durable-loader:loadAdmittedArtifact
    775:durable-loader:loadAdmittedArtifact
    843:durable-loader:loadAdmittedArtifact
    868:durable-loader:loadAdmittedArtifact
    873:durable-loader:loadAdmittedArtifact
    878:durable-loader:loadAdmittedArtifact
    883:durable-loader:loadAdmittedArtifact
    923:durable-loader:loadAdmittedArtifact
    928:durable-loader:loadAdmittedArtifact
    934:durable-loader:loadAdmittedArtifact
    963:durable-loader:loadAdmittedBlueprint
    967:durable-loader:loadAdmittedArtifact
    972:durable-loader:loadAdmittedArtifact
    982:durable-loader:loadAdmittedArtifact
    1052:durable-loader:loadAdmittedBlueprint
    1056:durable-loader:loadAdmittedArtifact
    1061:durable-loader:loadAdmittedArtifact
    1066:durable-loader:loadAdmittedArtifact
    1467:durable-loader:loadAdmittedBlueprint
    1471:durable-loader:loadAdmittedArtifact
    1515:durable-loader:loadAdmittedBlueprint
    1540:durable-loader:loadAdmittedBlueprint
    1571:durable-loader:loadAdmittedBlueprint
    1583:durable-loader:loadAdmittedBlueprint
    1599:durable-loader:loadAdmittedArtifact
    1673:durable-loader:loadAdmittedBlueprint
    1677:durable-loader:loadAdmittedArtifact
    1682:durable-loader:loadAdmittedArtifact
    1687:durable-loader:loadAdmittedArtifact
    1712:durable-loader:loadAdmittedBlueprint
    1716:durable-loader:loadAdmittedArtifact
    1735:durable-loader:loadAdmittedBlueprint
    1739:durable-loader:loadAdmittedArtifact
    1744:durable-loader:loadAdmittedArtifact
    1749:durable-loader:loadAdmittedArtifact
    1755:durable-loader:loadAdmittedArtifact
    1767:durable-loader:loadAdmittedArtifact
    1816:durable-loader:loadAdmittedBlueprint
    2811:serializer-to-sink:emitPersistableOutput
    2823:serializer-to-sink:emitPersistableOutput
    2836:serializer-to-sink:emitPersistableOutput
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-05", "gated", `
    1171:filesystem-read:fs.lstat
    1192:filesystem:fs.writeFile
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-08", "gated", `
    1312:durable-loader:loadAdmittedArtifact
    4599:durable-loader:loadAdmittedArtifact
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-12", "gated", `
    4542:durable-loader:loadAdmittedArtifact
    4547:durable-loader:loadAdmittedArtifact
    4552:durable-loader:loadAdmittedArtifact
    4557:durable-loader:loadAdmittedArtifact
    4562:durable-loader:loadAdmittedArtifact
    4573:durable-loader:loadAdmittedArtifact
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-16", "gated", `
    4291:filesystem-read:fs.realpath
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "non-artifact", `
    3094:process-output:process.stdout.write
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "diagnostic", `
    3098:process-output:process.stdout.write
    3102:process-output:process.stdout.write
    3106:process-output:process.stderr.write
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "transient-runtime", `
    5639:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "ephemeral-secret", `
    5665:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-19", "non-artifact-intake", `

  `),
  exactModuleSurfaceGroup("src/openclaw-authority-consumption.js", "phase-04-plan-14", "gated", `
    66:filesystem-lifecycle:fs.mkdir
    77:filesystem-open:fs.open
    83:file-handle-lifecycle:FileHandle.sync
    84:file-handle-read:FileHandle.stat
    85:filesystem-read:fs.lstat
    121:filesystem-read:fs.realpath
    122:filesystem-read:fs.lstat
    745:filesystem-read:fs.lstat
    881:filesystem-read:fs.lstat
    889:filesystem-open:fs.open
    893:file-handle-read:FileHandle.stat
    906:file-handle-read:FileHandle.readFile
    907:file-handle-read:FileHandle.stat
    908:filesystem-read:fs.lstat
    909:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/openclaw-authority-root-binding.js", "phase-04-plan-19", "gated", `
    62:filesystem-lifecycle:fs.mkdir
    70:filesystem-lifecycle:fs.mkdir
    162:filesystem-open:fs.open
    168:file-handle:FileHandle.writeFile
    169:file-handle-lifecycle:FileHandle.sync
    186:filesystem-read:fs.lstat
    187:filesystem-open:fs.open
    188:file-handle-read:FileHandle.stat
    190:file-handle-read:FileHandle.readFile
    191:file-handle-read:FileHandle.stat
    192:filesystem-read:fs.lstat
    245:filesystem-read:fs.realpath
    246:filesystem-read:fs.lstat
    268:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/openclaw-credential-handoff.js", "phase-04-plan-14", "gated", ``),
  exactModuleSurfaceGroup("src/openclaw-install-approval.js", "phase-04-plan-14", "gated", `
    429:filesystem-read:fs.lstat
    488:file-handle-read:FileHandle.stat
    489:file-handle:FileHandle.writeFile
    490:file-handle-lifecycle:FileHandle.sync
    493:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/openclaw-install-plan.js", "phase-04-plan-15", "gated", `
    356:file-handle-read:FileHandle.stat
    357:file-handle:FileHandle.writeFile
    358:file-handle-lifecycle:FileHandle.sync
    361:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/openclaw-install-receipt.js", "phase-04-plan-16", "gated", `
    267:file-handle-read:FileHandle.stat
    268:file-handle:FileHandle.writeFile
    269:file-handle-lifecycle:FileHandle.sync
    272:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/openclaw-install-transaction.js", "phase-04-plan-15", "gated", `
    201:durable-loader:loadAdmittedArtifact
    726:durable-loader:loadAdmittedArtifact
    842:filesystem-open:fs.open
    846:file-handle-read:FileHandle.stat
    850:file-handle-read:FileHandle.readFile
    851:file-handle-read:FileHandle.stat
    852:filesystem-read:fs.lstat
    1857:filesystem-read:fs.realpath
    1858:filesystem-read:fs.lstat
    2037:filesystem-read:fs.access
    2047:filesystem-read:fs.access
  `),
  exactModuleSurfaceGroup("src/openclaw-install-transaction.js", "phase-04-plan-16", "gated", `
    1008:durable-loader:loadAdmittedArtifact
    1019:durable-loader:loadAdmittedArtifact
  `),
  exactModuleSurfaceGroup("src/openclaw-official-action-runner.js", "phase-04-plan-15", "gated", `
    84:filesystem-lifecycle:fs.mkdtemp
    87:filesystem-lifecycle:fs.chmod
    89:filesystem-open:fs.open
    96:file-handle:FileHandle.writeFile
    97:file-handle-lifecycle:FileHandle.sync
    186:filesystem-open:fs.open
    193:file-handle:FileHandle.writeFile
    194:file-handle-lifecycle:FileHandle.sync
    470:filesystem-lifecycle:fs.mkdtemp
    473:filesystem-lifecycle:fs.chmod
    480:filesystem-open:fs.open
    486:file-handle:FileHandle.writeFile
    487:file-handle-lifecycle:FileHandle.sync
    491:filesystem-open:fs.open
    492:filesystem-open:fs.open
    493:filesystem-open:fs.open
    497:file-handle-read:FileHandle.stat
    498:file-handle-read:FileHandle.stat
    532:filesystem-read:fs.lstat
    554:filesystem-read:fs.lstat
    589:file-handle-read:FileHandle.stat
    601:file-handle-read:FileHandle.read
    612:file-handle-read:FileHandle.stat
    758:filesystem-open:fs.open
    759:file-handle-read:FileHandle.stat
    760:file-handle-read:FileHandle.readFile
    761:file-handle-read:FileHandle.stat
    762:filesystem-read:fs.lstat
    790:filesystem-open:fs.open
    791:file-handle-read:FileHandle.stat
    792:file-handle-read:FileHandle.readFile
    793:file-handle-read:FileHandle.stat
    794:filesystem-read:fs.lstat
    817:filesystem-open:fs.open
    818:file-handle-read:FileHandle.stat
    819:file-handle-read:FileHandle.readFile
    820:file-handle-read:FileHandle.stat
    821:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/openclaw-official-action-runner.js", "phase-04-plan-19", "gated", `
    1042:filesystem-open:fs.open
    1046:file-handle-read:FileHandle.stat
    1047:file-handle-read:FileHandle.readFile
    1048:file-handle-read:FileHandle.stat
    1049:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/openclaw-process-supervisor.js", "phase-04-plan-19", "gated", `
    51:filesystem-lifecycle:fs.mkdtemp
    54:filesystem-lifecycle:fs.chmod
    160:filesystem-open:fs.open
    167:file-handle:FileHandle.writeFile
    168:file-handle-lifecycle:FileHandle.sync
    375:filesystem-open:fs.open
    379:file-handle-read:FileHandle.stat
    380:file-handle-read:FileHandle.readFile
    381:file-handle-read:FileHandle.stat
    382:filesystem-read:fs.lstat
    402:filesystem-open:fs.open
    408:file-handle:FileHandle.writeFile
    409:file-handle-lifecycle:FileHandle.sync
    419:filesystem-open:fs.open
    424:filesystem-read:fs.lstat
    437:file-handle-read:FileHandle.stat
    443:file-handle-read:FileHandle.stat
    460:file-handle-read:FileHandle.read
    468:filesystem-read:fs.realpath
    492:filesystem-read:fs.lstat
    504:filesystem-open:fs.open
    508:file-handle-read:FileHandle.stat
    509:file-handle-read:FileHandle.readFile
    510:file-handle-read:FileHandle.stat
    511:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/openclaw-safe-fs.js", "phase-04-plan-13", "gated", `
    178:filesystem-lifecycle:fs.mkdtemp
    181:filesystem-lifecycle:fs.chmod
    238:filesystem-open:fs.open
    249:file-handle-read:FileHandle.stat
    250:filesystem-read:fs.lstat
    305:file-handle:FileHandle.writeFile
    307:file-handle-lifecycle:FileHandle.sync
    500:filesystem-read:fs.lstat
    507:filesystem-lifecycle:fs.mkdtemp
    510:filesystem-lifecycle:fs.chmod
    512:filesystem-open:fs.open
    519:file-handle:FileHandle.writeFile
    520:file-handle-lifecycle:FileHandle.sync
    735:managed-writer:stdin.write
    791:stream-write:stdin.end
    799:filesystem-read:fs.realpath
    833:filesystem-lifecycle:fs.mkdtemp
    836:filesystem-lifecycle:fs.chmod
    990:filesystem-open:fs.open
    994:file-handle-read:FileHandle.stat
    1003:file-handle-read:FileHandle.readFile
    1004:file-handle-read:FileHandle.stat
    1005:filesystem-read:fs.lstat
    1024:filesystem-open:fs.open
    1029:file-handle-read:FileHandle.stat
    1030:filesystem-read:fs.lstat
    1148:filesystem-read:fs.lstat
    1288:filesystem-open:fs.open
    1294:file-handle-lifecycle:FileHandle.sync
    1304:filesystem-open:fs.open
    1311:file-handle:FileHandle.writeFile
    1312:file-handle-lifecycle:FileHandle.sync
    1313:file-handle-read:FileHandle.stat
  `),
  exactModuleSurfaceGroup("src/openclaw-safe-fs.js", "phase-04-plan-19", "gated", `
    898:stream-write:stdin.end
    931:filesystem-open:fs.open
    936:filesystem-read:fs.lstat
    951:file-handle-read:FileHandle.stat
    959:file-handle-read:FileHandle.stat
    978:file-handle-read:FileHandle.read
  `),
  exactModuleSurfaceGroup("src/native-build-capture.js", "phase-04-plan-19", "gated", `
    174:stream-write:stdin.end
    175:stream-write:null.end
    182:filesystem-open:fs.open
    183:file-handle-read:FileHandle.stat
    185:file-handle-read:FileHandle.readFile
    186:file-handle-read:FileHandle.stat
    187:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/openclaw-probe.js", "phase-04-plan-12", "gated", `
    94:durable-loader:loadAdmittedArtifact
    100:durable-loader:loadAdmittedArtifact
    122:filesystem-lifecycle:fs.mkdtemp
    123:filesystem-lifecycle:fs.chmod
    136:filesystem-lifecycle:fs.mkdir
    137:filesystem-lifecycle:fs.chmod
    140:filesystem-read:fs.lstat
    400:filesystem-read:fs.lstat
    406:filesystem-read:fs.realpath
    415:filesystem-open:fs.open
    419:file-handle-read:FileHandle.stat
    428:file-handle-read:FileHandle.stat
    470:file-handle-read:FileHandle.read
    483:filesystem-open:fs.open
    491:file-handle:FileHandle.writeFile
    492:file-handle-lifecycle:FileHandle.sync
    493:managed-filesystem:writableHandle.chmod
    494:file-handle-read:FileHandle.stat
    495:filesystem-open:fs.open
    499:file-handle-read:FileHandle.stat
    505:filesystem-read:fs.lstat
    506:file-handle-read:FileHandle.stat
    538:filesystem-open:fs.open
    542:filesystem-open:fs.open
    543:file-handle-read:FileHandle.stat
    544:file-handle-read:FileHandle.stat
    545:filesystem-read:fs.lstat
    572:filesystem-read:fs.lstat
    579:file-handle-read:FileHandle.stat
    580:filesystem-read:fs.lstat
    591:filesystem-read:fs.lstat
    600:filesystem-open:fs.open
    602:file-handle-read:FileHandle.stat
    603:file-handle-read:FileHandle.stat
    609:filesystem-read:fs.lstat
    610:file-handle-read:FileHandle.stat
    716:stream-write:stdin.end
  `),
  exactModuleSurfaceGroup("src/package-archive.js", "phase-04-plan-03", "gated", `
    34:filesystem-read:fs.lstat
    177:filesystem-open:fs.open
    178:file-handle-read:FileHandle.stat
    180:file-handle-read:FileHandle.readFile
    187:filesystem-read:fs.readdir
  `),
  exactModuleSurfaceGroup("src/package-inspect.js", "phase-04-plan-04", "gated", `
    67:filesystem-read:fs.lstat
    143:filesystem-read:fs.lstat
    411:filesystem-read:fs.readdir
    416:filesystem-read:fs.lstat
    435:filesystem-read:fs.lstat
  `),
  exactModuleSurfaceGroup("src/package-produce.js", "phase-04-plan-17", "gated", `
    213:filesystem-lifecycle:fs.mkdir
    222:filesystem-lifecycle:fs.mkdir
    468:durable-loader:loadAdmittedArtifact
    652:filesystem-open:fs.open
    658:file-handle:FileHandle.writeFile
    659:file-handle-lifecycle:FileHandle.sync
    660:file-handle-read:FileHandle.stat
    668:filesystem-read:fs.stat
    729:filesystem-read:fs.lstat
    756:filesystem-read:fs.lstat
    766:filesystem-read:fs.lstat
    771:filesystem-open:fs.open
    775:file-handle-read:FileHandle.stat
    776:file-handle-read:FileHandle.readFile
    777:file-handle-read:FileHandle.stat
    778:filesystem-read:fs.lstat
    800:filesystem-open:fs.open
    806:file-handle-lifecycle:FileHandle.sync
  `),
  exactModuleSurfaceGroup("src/poc-agent.js", "phase-04-plan-19", "non-artifact-intake", `
    71:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/poc-agent.js", "phase-04-plan-19", "gated", `
    156:managed-writer:persistability.writePersistableJsonAtomic
    158:managed-writer:persistability.writePersistableProductTextAtomic
    202:filesystem-read:fs.readFile
    341:filesystem-read:fs.lstat
    352:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/poc-research-workspace.js", "phase-04-plan-19", "gated", `
    37:managed-writer:persistability.writePersistableJsonAtomic
    38:managed-writer:persistability.writePersistableJsonAtomic
    48:managed-writer:persistability.writePersistableJsonAtomic
    49:managed-writer:persistability.writePersistableProductTextAtomic
    54:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/poc-openclaw-runtime.js", "phase-04-plan-19", "transient-runtime", `
    191:filesystem-lifecycle:fs.mkdir
    269:filesystem-lifecycle:fs.mkdir
  `),
  exactModuleSurfaceGroup("src/poc-openclaw-runtime.js", "phase-04-plan-19", "ephemeral-secret", `
    374:filesystem-read:fs.readFile
  `),
]);

reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  exactModuleSurfaceGroup("scripts/check-single-flight.js", "phase-04-plan-19", "transient-runtime", `
    20:filesystem-open:fs.open
    29:filesystem-lifecycle:fs.unlink
  `),
  exactModuleSurfaceGroup("scripts/check-single-flight.js", "phase-04-plan-19", "diagnostic", `
    65:process-output:process.stderr.write
  `),
]);

// The Candidate CLI split keeps the command in its existing ownership phase
// while moving its two exact durable admissions out of the root CLI.
reconcileExactModuleSurfaces(IO_SURFACE_ALLOWLIST, [
  exactModuleSurfaceGroup("scripts/node20-core-receipt.js", "phase-01.2-plan-11", "diagnostic", `
    812:process-output:process.stderr.write
  `),
  exactModuleSurfaceGroup("scripts/node20-core-receipt.js", "phase-01.2-plan-11", "non-artifact-intake", `
    127:filesystem-read:fs.realpath
    128:filesystem-read:fs.realpath
    129:filesystem-read:fs.stat
    150:filesystem-read:fs.readFile
    183:filesystem-read:fs.readFile
    276:filesystem-read:fs.readFile
    465:filesystem-read:fs.createReadStream
    566:filesystem-read:fs.stat
    576:filesystem-read:fs.createReadStream
    588:filesystem-read:fs.lstat
    791:filesystem-read:fs.realpath
    792:filesystem-read:fs.realpath
  `),
  exactModuleSurfaceGroup("scripts/node20-core-receipt.js", "phase-01.2-plan-11", "gated", `
    354:managed-writer:persistability.writePersistableJsonAtomic
  `),
  exactModuleSurfaceGroup("scripts/node20-core-receipt.js", "phase-01.2-plan-11", "non-artifact", `
    357:process-output:process.stdout.write
  `),
  exactModuleSurfaceGroup("src/agent-idea-candidate-cli.js", "phase-03-plan-05", "gated", `
    25:durable-loader:loadAdmittedArtifact
    30:durable-loader:loadAdmittedArtifact
  `),
  exactModuleSurfaceGroup("src/builder-package.js", "phase-02-plan-17", "gated", `
    348:filesystem-read:fs.lstat
    353:filesystem-open:fs.open
    354:file-handle-read:FileHandle.stat
    357:file-handle-read:FileHandle.stat
    358:filesystem-read:fs.lstat
    666:filesystem-read:fs.lstat
    674:filesystem-read:fs.lstat
    697:filesystem-read:fs.realpath
    745:filesystem-read:fs.lstat
    746:filesystem-read:fs.lstat
    777:filesystem-read:fs.readdir
    778:filesystem-read:fs.lstat
    785:filesystem-read:fs.lstat
    786:filesystem-read:fs.lstat
    965:file-handle-read:FileHandle.read
    1330:filesystem-read:fs.readdir
    1343:filesystem-read:fs.lstat
    1344:filesystem-read:fs.realpath
    2084:filesystem-read:fs.lstat
    2088:filesystem-read:fs.realpath
    2099:filesystem-read:fs.lstat
    2109:filesystem-read:fs.lstat
    2135:filesystem-read:fs.realpath
    2194:filesystem-read:fs.lstat
    2195:filesystem-read:fs.realpath
    2447:filesystem-read:fs.lstat
    2533:filesystem-read:fs.lstat
    2537:filesystem-read:fs.realpath
    2540:filesystem-open:fs.open
    2541:file-handle-read:FileHandle.stat
    2546:file-handle-read:FileHandle.stat
    2547:filesystem-read:fs.lstat
    2667:filesystem-read:fs.realpath
    2696:filesystem-read:fs.lstat
    2697:filesystem-read:fs.realpath
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-03-plan-05", "gated", `
    623:durable-loader:loadAdmittedBlueprint
    648:durable-loader:loadAdmittedBlueprint
    653:durable-loader:loadAdmittedArtifact
    746:durable-loader:loadAdmittedArtifact
    751:durable-loader:loadAdmittedArtifact
    831:durable-loader:loadAdmittedArtifact
    856:durable-loader:loadAdmittedArtifact
    861:durable-loader:loadAdmittedArtifact
    866:durable-loader:loadAdmittedArtifact
    871:durable-loader:loadAdmittedArtifact
    911:durable-loader:loadAdmittedArtifact
    916:durable-loader:loadAdmittedArtifact
    922:durable-loader:loadAdmittedArtifact
    951:durable-loader:loadAdmittedBlueprint
    955:durable-loader:loadAdmittedArtifact
    960:durable-loader:loadAdmittedArtifact
    970:durable-loader:loadAdmittedArtifact
    1040:durable-loader:loadAdmittedBlueprint
    1044:durable-loader:loadAdmittedArtifact
    1049:durable-loader:loadAdmittedArtifact
    1054:durable-loader:loadAdmittedArtifact
    1455:durable-loader:loadAdmittedBlueprint
    1459:durable-loader:loadAdmittedArtifact
    1503:durable-loader:loadAdmittedBlueprint
    1528:durable-loader:loadAdmittedBlueprint
    1559:durable-loader:loadAdmittedBlueprint
    1571:durable-loader:loadAdmittedBlueprint
    1587:durable-loader:loadAdmittedArtifact
    1661:durable-loader:loadAdmittedBlueprint
    1665:durable-loader:loadAdmittedArtifact
    1670:durable-loader:loadAdmittedArtifact
    1675:durable-loader:loadAdmittedArtifact
    1700:durable-loader:loadAdmittedBlueprint
    1704:durable-loader:loadAdmittedArtifact
    1723:durable-loader:loadAdmittedBlueprint
    1727:durable-loader:loadAdmittedArtifact
    1732:durable-loader:loadAdmittedArtifact
    1737:durable-loader:loadAdmittedArtifact
    1743:durable-loader:loadAdmittedArtifact
    1755:durable-loader:loadAdmittedArtifact
    1804:durable-loader:loadAdmittedBlueprint
    2799:serializer-to-sink:emitPersistableOutput
    2811:serializer-to-sink:emitPersistableOutput
    2824:serializer-to-sink:emitPersistableOutput
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-05", "gated", `
    1159:filesystem-read:fs.lstat
    1180:filesystem:fs.writeFile
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-08", "gated", `
    1300:durable-loader:loadAdmittedArtifact
    4555:durable-loader:loadAdmittedArtifact
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-12", "gated", `
    4498:durable-loader:loadAdmittedArtifact
    4503:durable-loader:loadAdmittedArtifact
    4508:durable-loader:loadAdmittedArtifact
    4513:durable-loader:loadAdmittedArtifact
    4518:durable-loader:loadAdmittedArtifact
    4529:durable-loader:loadAdmittedArtifact
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-16", "gated", `
    4247:filesystem-read:fs.realpath
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "non-artifact", `
    3084:process-output:process.stdout.write
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "diagnostic", `
    3088:process-output:process.stdout.write
    3092:process-output:process.stdout.write
    3096:process-output:process.stderr.write
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "transient-runtime", `
    5613:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-02-plan-20", "ephemeral-secret", `
    5639:filesystem-read:fs.readFile
  `),
  exactModuleSurfaceGroup("src/cli.js", "phase-04-plan-19", "non-artifact-intake", ``),
  // This authoring-only Plan command writes one private 0700 stage, links it
  // into an absent public name, and cleans only the verified private stage.
  // It has no public-output rollback or post-publication mutation surface.
  exactModuleSurfaceGroup("src/decision-entry-canonicalizer.js", "phase-03-plan-05", "gated", `
    134:filesystem-lifecycle:fs.link
    150:filesystem-read:fs.lstat
    152:filesystem-open:fs.open
    153:file-handle-read:FileHandle.stat
    154:filesystem-read:fs.lstat
    161:file-handle-lifecycle:FileHandle.sync
    172:file-handle-read:FileHandle.stat
    173:filesystem-read:fs.lstat
    191:filesystem-lifecycle:fs.mkdtemp
    192:filesystem-lifecycle:fs.chmod
    193:filesystem-read:fs.lstat
    194:filesystem-open:fs.open
    195:file-handle-read:FileHandle.stat
    196:filesystem-read:fs.lstat
    223:filesystem-open:fs.open
    224:file-handle:FileHandle.writeFile
    225:file-handle-lifecycle:FileHandle.sync
    226:file-handle-read:FileHandle.stat
    227:filesystem-read:fs.lstat
    247:file-handle-read:FileHandle.stat
    252:file-handle-read:FileHandle.read
    263:file-handle-read:FileHandle.stat
    274:file-handle-read:FileHandle.stat
    275:filesystem-read:fs.lstat
    279:file-handle-read:FileHandle.stat
    280:filesystem-read:fs.lstat
    286:filesystem-lifecycle:fs.unlink
    288:filesystem-lifecycle:fs.rmdir
  `),
  exactModuleSurfaceGroup("src/poc-openclaw-runtime.js", "phase-04-plan-19", "transient-runtime", `
    196:filesystem-lifecycle:fs.mkdir
    275:filesystem-lifecycle:fs.mkdir
  `),
  exactModuleSurfaceGroup("src/poc-openclaw-runtime.js", "phase-04-plan-19", "ephemeral-secret", `
    380:filesystem-read:fs.readFile
  `),
]);


function reconcileExactModuleSurfaces(allowlist, groups) {
  const files = new Set(groups.map((group) => group.file));
  for (const id of Array.from(allowlist.keys())) {
    if (files.has(id.split(":", 1)[0])) allowlist.delete(id);
  }
  for (const group of groups) {
    for (const id of group.ids) {
      if (!id.startsWith(`${group.file}:`) || allowlist.has(id)) throw new Error("duplicate I/O surface");
      allowlist.set(id, Object.freeze({ owner: group.owner, status: group.status }));
    }
  }
}


export async function inventoryIoSurfaces(repoRoot) {
  const roots = ["src", "bin", "scripts", "plugin"];
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
    } else if (JS_EXTENSIONS.has(path.extname(file))) {
      surfaces.push(...inventoryJavaScriptSource(source, relativePath));
    }
  }
  return surfaces.sort(compareSurfaces);
}

export const scanIoSurfaces = inventoryIoSurfaces;

export function inventoryJavaScriptSource(source, file = "fixture.js") {
  return analyzeJavaScriptSource(source, {
    file,
    includeProcessEffects: file === "plugin/hooks/agentmo-hook.js",
  }).ioSurfaces;
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
      surfaces.push(surface(file, lineNumber, "filesystem-read", "fs.readFileSync"));
      surfaces.push(surface(file, lineNumber, "shell-exact-byte-read", "fs.readFileSync"));
    }
    if (/\bprocess\s*\.\s*(?:stdout|stderr)\s*\.\s*write\s*\(/u.test(line)) {
      const channel = /\bprocess\s*\.\s*stderr\s*\./u.test(line) ? "stderr" : "stdout";
      surfaces.push(surface(file, lineNumber, "process-output", `process.${channel}.write`));
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

export function assertBuilderV1NoPhysicalMutationSource(source, file = "fixture.js") {
  const extension = path.extname(file);
  const surfaces = SHELL_EXTENSIONS.has(extension)
    ? inventoryShellSource(source, file)
    : inventoryJavaScriptSource(source, file);
  const forbiddenMethods = new Set(["rename", "rm", "rmdir", "unlink"]);
  const violations = surfaces
    .filter((item) => forbiddenMethods.has(item.callee.split(".").at(-1)))
    .map((item) => ({ file: item.file, line: item.line, operation: item.callee }));

  if (JS_EXTENSIONS.has(extension)) {
    const removeCommand = /\b(?:exec|execFile|execFileSync|execSync|spawn|spawnSync)\s*\([\s\S]{0,2048}?(?:["'](?:remove|uninstall|purge)["']|["']--remove-host-selector["'])/gu;
    for (const match of source.matchAll(removeCommand)) {
      violations.push({
        file: normalizePath(file),
        line: source.slice(0, match.index).split(/\r?\n/u).length,
        operation: "external-remove-command",
      });
    }
  } else if (SHELL_EXTENSIONS.has(extension)) {
    for (const [zeroIndex, line] of source.split(/\r?\n/u).entries()) {
      if (/^\s*(?:command\s+)?(?:rm|rmdir)\b/u.test(line)
        || /\b(?:codex|npm|npx)\b[^\n]*\b(?:remove|uninstall|purge)\b/u.test(line)) {
        violations.push({
          file: normalizePath(file),
          line: zeroIndex + 1,
          operation: "external-remove-command",
        });
      }
    }
  }

  if (violations.length > 0) {
    const error = new Error(
      `AgentMo v1 forbids physical deletion, canonical replacement, and remove commands: ${violations
        .map((item) => `${item.file}:${item.line}:${item.operation}`)
        .join(", ")}`,
    );
    error.code = "AGENTMO_BUILDER_V1_PHYSICAL_MUTATION_FORBIDDEN";
    error.violations = Object.freeze(violations.map((item) => Object.freeze(item)));
    throw error;
  }
}

export async function assertBuilderV1NoPhysicalMutationPolicy(repoRoot) {
  const protectedFiles = (await Promise.all([
    walkFiles(path.join(repoRoot, "src")),
    walkFiles(path.join(repoRoot, "plugin")),
    walkFiles(path.join(repoRoot, "scripts")),
  ])).flat().filter((file) => {
    const relative = normalizePath(path.relative(repoRoot, file));
    return relative === "src/cli.js"
      || relative.startsWith("src/builder-")
      || relative.startsWith("src/builders/")
      || relative.startsWith("plugin/")
      || /^scripts\/(?:build-builder|verify-codex-uat)/u.test(relative);
  }).sort();
  for (const file of protectedFiles) {
    const relative = normalizePath(path.relative(repoRoot, file));
    assertBuilderV1NoPhysicalMutationSource(await readFile(file, "utf8"), relative);
  }
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
