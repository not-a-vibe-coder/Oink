type ServerEntry = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response };

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  serverEntryPromise ??= import("@tanstack/react-start/server-entry").then((module) => (module.default ?? module) as ServerEntry);
  return serverEntryPromise;
}

export default { fetch: async (request: Request, env: unknown, ctx: unknown) => (await getServerEntry()).fetch(request, env, ctx) };
