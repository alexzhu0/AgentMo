import assert from "node:assert/strict";
import { constants } from "node:fs";
import { chmod, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { captureIndependentNativeBuilds } from "../src/native-build-capture.js";

test("native capture denies same-UID writes to both exact compiler output descriptors", {
  skip: process.platform !== "linux" || process.arch !== "x64" || process.getuid?.() === 0,
  timeout: 30_000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-native-capture-"));
  const wrapper = path.join(root, "cc-wrapper");
  const gateRoot = path.join(root, "gate");
  await writeFile(wrapper, [
    "#!/usr/bin/perl",
    "use strict; use warnings;",
    `my $gate = mkdir('${gateRoot}.1.lock') ? 1 : 2;`,
    "my ($descriptor) = $ARGV[-1] =~ m{/([0-9]+)$};",
    "my $dumpable = syscall(157, 3, 0, 0, 0, 0);",
    `open(my $ready, '>', '${gateRoot}.ready.' . $gate) or die;`,
    "print {$ready} \"$$ $descriptor $dumpable\\n\"; close($ready) or die;",
    `while (!-e ('${gateRoot}.release.' . $gate)) { }`,
    "exec {'/usr/bin/cc'} '/usr/bin/cc', @ARGV; exit 126;",
  ].join("\n"), { mode: 0o700 });
  await chmod(wrapper, 0o700);
  const capture = captureIndependentNativeBuilds({
    buildRoot: root,
    compilerArgs: ["-x", "c", "-", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-o", "/proc/self/fd/4"],
    compilerPath: wrapper,
    environment: { HOME: root, LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin", TMPDIR: root },
    maxOutputBytes: 64 * 1024,
    sourceBytes: Buffer.from("int main(void) { return 0; }\n"),
    timeoutMs: 20_000,
  });
  for (const gate of [1, 2]) {
    const target = await waitForTarget(`${gateRoot}.ready.${gate}`);
    assert.equal(target.dumpable, 0);
    await assert.rejects(async () => {
      const descriptor = await open(`/proc/${target.pid}/fd/${target.descriptor}`, constants.O_WRONLY);
      await descriptor.close();
    }, (error) => ["EACCES", "EPERM", "ENOENT"].includes(error?.code));
    await writeFile(`${gateRoot}.release.${gate}`, "release\n", { flag: "wx", mode: 0o600 });
  }
  const result = await capture;
  assert.equal(result.transport, "preloaded-nondumpable-sealed-memfd");
  assert.equal(result.primary.bytes.equals(result.verification.bytes), true);
  assert.equal(result.primary.identity.links, "0");
  assert.equal(result.verification.identity.links, "0");
  assert.notEqual(result.primary.identity.inode, result.verification.identity.inode);
});

async function waitForTarget(filePath) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const [pid, descriptor, dumpable] = (await readFile(filePath, "utf8"))
        .trim().split(" ").map((value) => Number.parseInt(value, 10));
      if ([pid, descriptor, dumpable].every(Number.isSafeInteger)) return { pid, descriptor, dumpable };
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`native capture barrier missing: ${path.basename(filePath)}`);
}
