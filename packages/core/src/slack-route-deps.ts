import { inboxDeps } from "./inbox-deps";
import { panelUrl, secretValues } from "./slack";
import { postResponse, slackClient } from "@factory/integrations/slack-api";
import { ownerFromAllowlist, type InteractionDeps } from "./slack-interactions";

/** The hosting transport owns work scheduled after acknowledgment. */
export function slackRouteDeps(after: InteractionDeps["after"]): InteractionDeps {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  return {
    signingSecret: process.env.SLACK_SIGNING_SECRET?.trim(),
    ownerSlackId: process.env.SLACK_OWNER_USER_ID?.trim(),
    slack: token ? slackClient({ token, baseUrl: process.env.SLACK_API_URL?.trim() || undefined, minGapMs: 0 }) : null,
    respond: postResponse,
    inbox: inboxDeps(async () => ownerFromAllowlist()),
    panelUrl: panelUrl(),
    secrets: secretValues(process.env),
    after,
  };
}
