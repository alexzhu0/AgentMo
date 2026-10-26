import path from "node:path";
import { readBoundedNoFollowFile } from "./builder-package.js";
import { loadNativeChatInputs, readNativeChatJson } from "./native-chat-install-cli.js";
import { startNativeChat, stopNativeChat } from "./native-chat-runtime.js";
import { resolveRuntimeEnv } from "./runtime-env.js";
import { loadAdmittedArtifact } from "./artifact-admission.js";
import { admitPackageArchiveManifest } from "./package-archive.js";
import { buildDeliveryReport } from "./delivery-report.js";
import { nativeChatModelProfile } from "./native-chat-model-profile.js";

export async function runNativeChatCommand(args) {
  let run, controller;
  const stop = () => { controller?.abort(); void run?.stop(); };
  try {
    const [command, ...rest] = args;
    if (command === "stop") {
      const options = {};
      for (let i = 0; i < rest.length; i++) {
        const key = rest[i];
        if (Object.hasOwn(options, key)) throw new Error();
        if (key === "--json") { options[key] = true; continue; }
        if (!["--install-plan", "--install-plan-sha256", "--target-root"].includes(key) || !rest[i + 1] || rest[i + 1].startsWith("--")) throw new Error();
        options[key] = rest[++i];
      }
      const stateRoot = options["--target-root"];
      if (!path.isAbsolute(stateRoot ?? "") || path.resolve(stateRoot) !== stateRoot) throw new Error();
      const plan = await readNativeChatJson(options["--install-plan"], options["--install-plan-sha256"]);
      const result = await stopNativeChat({ plan, stateRoot });
      process.stdout.write(options["--json"] ? `${JSON.stringify(result)}\n` : "stopped\n");
      return;
    }
    if (command !== "serve") throw new Error();
    controller = new AbortController();
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    const { inputs, runtimeEnvFile, json } = await loadNativeChatInputs(command, rest);
    const model = nativeChatModelProfile(inputs.plan.nativeBinding.modelProfile);
    if (controller.signal.aborted) return;
    const runtimeEnv = resolveRuntimeEnv({ envFile: runtimeEnvFile,
      envFileContent: new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedNoFollowFile(runtimeEnvFile, 64 * 1024)),
      runtimeEnvAllowlist: [model.envName] });
    run = await startNativeChat({ ...inputs, apiKey: runtimeEnv.values[model.envName], signal: controller.signal });
    runtimeEnv.values[model.envName] = ""; runtimeEnv.secretValues.length = 0;
    if (controller.signal.aborted) { if ((await run.stop()).status !== "stopped") throw new Error(); return; }
    process.stdout.write(json ? `${JSON.stringify(run.entry)}\n` : `${run.entry.url}\n`);
    if ((await run.completion).status !== "stopped") throw new Error();
  } catch (error) {
    if (error?.code === "AGENTMO_NATIVE_ACTIVATION_CANCELLED") return;
    throw Object.assign(new Error("Native chat request was rejected."), { code: "AGENTMO_NATIVE_CHAT_REJECTED" });
  }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); if (run) await run.stop(); }
}

export async function runNativeDeliveryCommand(args) {
  try {
    const b=args.indexOf("--blueprint"),d=args.indexOf("--blueprint-sha256");
    if(b>=0&&d>=0&&b===args.lastIndexOf("--blueprint")&&d===args.lastIndexOf("--blueprint-sha256")&&!path.basename(args[b+1]??"").startsWith(".env")) {
      const blueprint=await loadAdmittedArtifact({subject:"blueprint",filePath:args[b+1],expectedDigest:args[d+1]});
      if(blueprint.value.native_runtime==="pi")return (await import("./pi-native-cli.js")).runPiDeliveryCommand(args);
    }
    const required=["execution-profile","blueprint","blueprint-sha256","archive","archive-sha256","install-plan","install-plan-sha256","install-receipt","install-receipt-sha256"];
    const allowed=[...required,"acceptance","acceptance-sha256"], options={};
    for(let i=0;i<args.length;i++){
      const key=args[i].slice(2);
      if(!args[i].startsWith("--")||Object.hasOwn(options,key))throw new Error();
      if(key==="json"){options.json=true;continue;}
      if(!allowed.includes(key)||!args[i+1]||args[i+1].startsWith("--"))throw new Error();
      options[key]=args[++i];
    }
    if(required.some(k=>!options[k])||options["execution-profile"]!=="native-chat"||Boolean(options.acceptance)!==Boolean(options["acceptance-sha256"]))throw new Error();
    for(const key of ["blueprint","archive","install-plan","install-receipt","acceptance"].filter(k=>options[k]))if(!path.isAbsolute(options[key])||path.resolve(options[key])!==options[key])throw new Error();
    const admissions={};
    for(const [key,flag,subject] of [["blueprint","blueprint","blueprint"],["activationPlan","install-plan","openclaw-install-plan"],["installReceipt","install-receipt","openclaw-install-receipt"],["acceptance","acceptance","native-chat-acceptance"]]){
      admissions[key]=options[flag]?await loadAdmittedArtifact({filePath:options[flag],expectedDigest:options[`${flag}-sha256`],subject}):null;
    }
    const archive=await admitPackageArchiveManifest({archivePath:options.archive,expectedArchiveDigest:options["archive-sha256"]});
    admissions.packageManifest=archive.manifest;
    if(admissions.activationPlan.value.archiveBinding.archiveSha256!==options["archive-sha256"])throw new Error();
    const report=await buildDeliveryReport(admissions.blueprint.value,{nativeChat:Object.fromEntries(["packageManifest","activationPlan","installReceipt","acceptance"].map(k=>[k,admissions[k]?.value??null])),admissions});
    return {report,json:options.json===true};
  }catch{throw Object.assign(new Error("Native delivery evidence was rejected."),{code:"AGENTMO_NATIVE_DELIVERY_REJECTED"});}
}
