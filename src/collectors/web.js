export async function collectWebSource(context) {
  const response = await context.retrieve(context.source.location, "web");
  if (response.status !== 200) throw context.fail("AGENTMO_DISCOVERY_LIVE_HTTP_STATUS");
  return context.buildRecord(response, {
    providerKind: "web",
    providerPolicy: {
      exactUrlAdmission: true,
      redirectMode: "manual-bounded",
      rawBodyStored: false,
    },
    evidenceClass: context.evidenceClass,
  });
}
