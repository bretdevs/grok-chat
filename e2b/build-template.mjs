// Builds the optional Agent sandbox template from e2b.Dockerfile with the E2B SDK.
// Usage: E2B_API_KEY=... node e2b/build-template.mjs [name]
// Then set E2B_TEMPLATE=<name> on the server.
import { fileURLToPath } from "node:url";
import { defaultBuildLogger, Template } from "e2b";

const name = process.argv[2] || "grok-chat-agent";
const dockerfile = fileURLToPath(new URL("./e2b.Dockerfile", import.meta.url));

const info = await Template.build(Template().fromDockerfile(dockerfile), name, {
  onBuildLogs: defaultBuildLogger(),
});
console.log(`Built ${info.name} (${info.templateId}). Set E2B_TEMPLATE=${info.name} on the server.`);
