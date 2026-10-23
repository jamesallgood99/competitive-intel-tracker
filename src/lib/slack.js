// Posting to Slack from the scheduled jobs (which run in GitHub Actions, not inside the bot).
// The bot itself uses Bolt; this is the same Web API, called directly.

export function hasSlack() {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

export async function slackApi(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}

// Opens (or reuses) a DM with a user and posts there.
export async function dm(userId, payload) {
  const { channel } = await slackApi('conversations.open', { users: userId });
  return slackApi('chat.postMessage', { channel: channel.id, ...payload });
}

// Resolves a channel name like "competitive-intel" to its ID, so the config can stay human-readable.
export async function channelId(nameOrId) {
  if (/^[CG][A-Z0-9]{6,}$/.test(nameOrId)) return nameOrId;
  const name = nameOrId.replace(/^#/, '');
  let cursor;
  do {
    const page = await slackApi('conversations.list', { limit: 500, cursor, exclude_archived: true, types: 'public_channel,private_channel' });
    const hit = page.channels.find((c) => c.name === name);
    if (hit) return hit.id;
    cursor = page.response_metadata?.next_cursor;
  } while (cursor);
  throw new Error(`Slack channel #${name} not found, or the bot isn't a member`);
}
