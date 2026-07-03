import path from "node:path";

export function fileMapToWriteOperations(files, context, source) {
  return Array.from(files.entries())
    .sort(([left], [right]) => comparePaths(left, right))
    .map(([relativePath, content]) => {
      const operation = {
        kind: "write-file",
        relativePath,
        ...(context.outputDir ? { destinationPath: path.join(context.outputDir, relativePath) } : {}),
        ownership: "managed",
        source: typeof source === "function" ? source(relativePath) : source,
        scaffoldOnly: true,
      };
      Object.defineProperty(operation, "content", {
        value: content,
        enumerable: false,
      });
      return operation;
    });
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
