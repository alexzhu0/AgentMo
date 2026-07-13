// Contract-only preload: simulate an incompatible current process for CLI ordering tests.
// This fixture is test evidence only; production code and release execution must never import it.
const descriptor = Object.getOwnPropertyDescriptor(process.versions, "node");

if (descriptor?.configurable !== true) {
  throw new Error("Contract-only runtime fixture requires a configurable process.versions.node descriptor.");
}

Object.defineProperty(process.versions, "node", {
  ...descriptor,
  value: "20.19.0",
});
