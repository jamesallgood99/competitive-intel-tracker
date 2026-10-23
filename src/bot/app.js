#!/usr/bin/env node
// The Slack side of the tracker. Reps never leave Slack:
//   - post intel in the channel → Claude triages it → the admin approves, edits or rejects → it's on the card
//   - /battlecard <name>            → the card's link and positioning statement
//   - /battlecard request <name>    → the admin approves it and the pages the scraper may use
//   - the admin publishes the monthly update and confirms stale cards from buttons in their DMs
//
// Runs in Socket Mode by default (no public URL needed). Set SLACK_SIGNING_SECRET and leave out
// SLACK_APP_TOKEN to run over HTTP instead.
import bolt from '@slack/bolt';
import { loadConfig, cardUrl, slugify, categoryById } from '../lib/config.js';
import { askJson, hasKey } from '../lib/claude.js';
import { triageIntelPrompt } from '../lib/prompts.js';
import { dispatchWorkflow } from '../lib/github.js';
import { emptyCard } from '../lib/kb.js';
import { isoDate } from '../lib/dates.js';
import * as kb from './kb-remote.js';
import * as ui from './blocks.js';

const { App, LogLevel } = bolt;
const config = loadConfig();
const admins = new Set(config.slack.adminUserIds);
const primaryAdmin = config.slack.adminUserIds[0];

for (const v of ['SLACK_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY']) {
  if (!process.env[v]) throw new Error(`${v} is not set. See docs/slack-setup.md.`);
}
const socketMode = Boolean(process.env.SLACK_APP_TOKEN);
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  ...(socketMode ? { appToken: process.env.SLACK_APP_TOKEN, socketMode: true } : { signingSecret: process.env.SLACK_SIGNING_SECRET }),
  logLevel: process.env.DEBUG ? LogLevel.DEBUG : LogLevel.INFO,
});

let intelChannelId;
async function resolveIntelChannel(client) {
  if (intelChannelId) return intelChannelId;
  const name = config.slack.intelChannel.replace(/^#/, '');
  if (/^[CG][A-Z0-9]{6,}$/.test(name)) return (intelChannelId = name);
  for await (const page of client.paginate('conversations.list', { limit: 500, types: 'public_channel,private_channel' })) {
    const hit = page.channels.find((c) => c.name === name);
    if (hit) return (intelChannelId = hit.id);
  }
  throw new Error(`Channel #${name} not found, or the bot hasn't been invited`);
}

async function displayName(client, userId) {
  try {
    const { user } = await client.users.info({ user: userId });
    return user.profile.display_name || user.real_name || user.name;
  } catch {
    return userId;
  }
}

const isAdmin = (userId) => admins.has(userId);
async function denyIfNotAdmin(body, client) {
  if (isAdmin(body.user.id)) return false;
  await client.chat.postEphemeral({ channel: body.channel?.id ?? body.user.id, user: body.user.id, text: 'Only a tracker admin can do that.' }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// 1. Intel posted in the channel
// ---------------------------------------------------------------------------
app.message(async ({ message, client }) => {
  if (message.subtype || message.bot_id || message.thread_ts) return; // top-level human posts only
  if (message.channel !== (await resolveIntelChannel(client))) return;
  if (!message.text || message.text.trim().length < 15) return;

  const competitors = await kb.listCompetitors();
  const { data: triage } = await askJson(config, triageIntelPrompt(config, competitors.filter((c) => c.status === 'active'), message.text));
  if (!triage.isIntel) return;

  const card = triage.competitorSlug ? competitors.find((c) => c.slug === triage.competitorSlug) : null;
  if (!card && triage.newCompetitorName) {
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: `We don't track ${triage.newCompetitorName} yet. If they keep coming up, ask for a battlecard: \`/battlecard request ${triage.newCompetitorName}\``,
    });
    return;
  }
  if (!card) return;

  const { permalink } = await client.chat.getPermalink({ channel: message.channel, message_ts: message.ts });
  const payload = { c: message.channel, ts: message.ts, u: message.user, slug: card.slug, sum: triage.summary, sev: triage.severity, type: triage.type };
  await client.chat.postMessage({
    channel: primaryAdmin,
    text: `Competitive intel to review: ${card.name}`,
    blocks: ui.intelReviewBlocks(config, { triage, card, rep: message.user, permalink, original: message.text, payload }),
    unfurl_links: false,
  });
  await client.reactions.add({ channel: message.channel, timestamp: message.ts, name: 'eyes' }).catch(() => {});
  await client.chat.postMessage({
    channel: message.channel,
    thread_ts: message.ts,
    text: `Thanks. This looks like intel on *${card.name}*, so I've sent it to <@${primaryAdmin}> for review. You'll hear back here.`,
  });
});

async function approveIntel(client, payload, { text, slug, severity, approverId }) {
  const approver = await displayName(client, approverId);
  const author = await displayName(client, payload.u);
  const competitors = await kb.listCompetitors();
  const card = competitors.find((c) => c.slug === slug);
  await kb.addFieldIntel(
    slug,
    { date: isoDate(), author, text, source: `Slack #${config.slack.intelChannel}`, approvedBy: approver, severity },
    approver,
  );
  await client.reactions.remove({ channel: payload.c, timestamp: payload.ts, name: 'eyes' }).catch(() => {});
  await client.reactions.add({ channel: payload.c, timestamp: payload.ts, name: 'white_check_mark' }).catch(() => {});
  await client.chat.postMessage({
    channel: payload.c,
    thread_ts: payload.ts,
    text: `Approved and added to the <${cardUrl(config, slug)}|${card?.name ?? slug} battlecard>. It's live once the site rebuilds, usually within a few minutes.`,
    unfurl_links: false,
  });
  return card?.name ?? slug;
}

app.action('approve_intel', async ({ ack, body, client, action }) => {
  await ack();
  if (await denyIfNotAdmin(body, client)) return;
  const p = ui.unpack(action.value);
  const name = await approveIntel(client, p, { text: p.sum, slug: p.slug, severity: p.sev, approverId: body.user.id });
  await client.chat.update({ channel: body.channel.id, ts: body.message.ts, text: 'Approved', blocks: ui.decidedBlocks(`:white_check_mark: Approved for *${name}*`, p.sum) });
});

app.action('edit_intel', async ({ ack, body, client, action }) => {
  await ack();
  if (await denyIfNotAdmin(body, client)) return;
  const p = { ...ui.unpack(action.value), dm: body.channel.id, dmTs: body.message.ts };
  await client.views.open({ trigger_id: body.trigger_id, view: ui.editIntelModal(config, await kb.listCompetitors(), p) });
});

app.view('edit_intel_submit', async ({ ack, body, view, client }) => {
  await ack();
  const p = ui.unpack(view.private_metadata);
  const v = view.state.values;
  const slug = v.competitor.v.selected_option.value;
  const text = v.text.v.value.trim();
  const severity = v.severity.v.selected_option.value;
  const name = await approveIntel(client, p, { text, slug, severity, approverId: body.user.id });
  await client.chat.update({ channel: p.dm, ts: p.dmTs, text: 'Approved', blocks: ui.decidedBlocks(`:white_check_mark: Approved with edits for *${name}*`, text) });
});

app.action('reject_intel', async ({ ack, body, client, action }) => {
  await ack();
  if (await denyIfNotAdmin(body, client)) return;
  const p = { ...ui.unpack(action.value), dm: body.channel.id, dmTs: body.message.ts };
  await client.views.open({ trigger_id: body.trigger_id, view: ui.reasonModal('reject_intel_submit', 'Reject intel', p, 'Reason, sent privately to the rep (optional)') });
});

app.view('reject_intel_submit', async ({ ack, view, client }) => {
  await ack();
  const p = ui.unpack(view.private_metadata);
  const reason = view.state.values.reason.v.value?.trim();
  await client.reactions.remove({ channel: p.c, timestamp: p.ts, name: 'eyes' }).catch(() => {});
  // Tell the rep privately, so a rejection never plays out in front of the team.
  await client.chat.postMessage({
    channel: p.u,
    text: `Thanks for the intel you posted in #${config.slack.intelChannel}. It won't go on the battlecard this time.${reason ? `\n>${reason}` : ''}`,
  });
  await client.chat.update({ channel: p.dm, ts: p.dmTs, text: 'Rejected', blocks: ui.decidedBlocks(':x: Rejected', reason || p.sum) });
});

// ---------------------------------------------------------------------------
// 2. /battlecard
// ---------------------------------------------------------------------------
app.command('/battlecard', async ({ ack, command, client, respond }) => {
  await ack();
  const input = command.text.trim();
  const requestMatch = input.match(/^request\s+(.+)$/i);

  if (requestMatch) {
    const [rawName, ...why] = requestMatch[1].split(/\s+[-—]\s+|:\s+/);
    const name = rawName.trim();
    const reason = why.join(' ').trim();
    const existing = kb.findCompetitor(await kb.listCompetitors(), name);
    if (existing) {
      await respond({ response_type: 'ephemeral', text: `There's already a battlecard for ${existing.name}.`, blocks: ui.cardBlocks(config, existing) });
      return;
    }
    const payload = { name, reason, u: command.user_id, c: command.channel_id, web: null, id: `r-${isoDate().replace(/-/g, '')}-${slugify(name)}` };
    await client.chat.postMessage({ channel: primaryAdmin, text: `Battlecard request: ${name}`, blocks: ui.requestReviewBlocks({ name, reason, rep: command.user_id, payload }) });
    await respond({ response_type: 'ephemeral', text: `Request sent to <@${primaryAdmin}>. I'll message you when it's approved or not.` });
    return;
  }

  const competitors = await kb.listCompetitors();
  if (!input || input === 'help') {
    const byCat = config.categories
      .map((cat) => `*${cat.name}:* ${competitors.filter((c) => c.status === 'active' && c.category === cat.id).map((c) => `<${cardUrl(config, c.slug)}|${c.name}>`).join(', ') || '_none yet_'}`)
      .join('\n');
    await respond({
      response_type: 'ephemeral',
      text: `${byCat}\n\nTry \`/battlecard watchpost\` for one card, or \`/battlecard request Company name - why you need it\` for a new one.`,
      unfurl_links: false,
    });
    return;
  }

  const card = kb.findCompetitor(competitors, input);
  if (!card) {
    await respond({ response_type: 'ephemeral', text: `No battlecard matches "${input}". Ask for one with \`/battlecard request ${input}\`.` });
    return;
  }
  await respond({
    response_type: 'ephemeral',
    text: `${card.name} battlecard: ${cardUrl(config, card.slug)}`,
    blocks: [...ui.cardBlocks(config, card), { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Share in this channel' }, action_id: 'share_card', value: card.slug }] }],
  });
});

app.action('share_card', async ({ ack, body, client, action, respond }) => {
  await ack();
  const card = (await kb.listCompetitors()).find((c) => c.slug === action.value);
  if (!card) return;
  await client.chat.postMessage({ channel: body.channel.id, text: `${card.name} battlecard`, blocks: ui.cardBlocks(config, card), unfurl_links: false });
  await respond({ delete_original: true });
});

// Mentions work like the slash command: "@Intel watchpost" or "@Intel request Acme".
app.event('app_mention', async ({ event, client }) => {
  const q = event.text.replace(/<@[^>]+>/g, '').trim();
  const card = q && kb.findCompetitor(await kb.listCompetitors(), q);
  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: card ? `${card.name} battlecard` : `I couldn't match "${q}" to a battlecard. Try \`/battlecard\` to see them all.`,
    ...(card ? { blocks: ui.cardBlocks(config, card) } : {}),
    unfurl_links: false,
  });
});

// ---------------------------------------------------------------------------
// 3. Battlecard requests: the admin approves the card and its sources
// ---------------------------------------------------------------------------
app.action('approve_request', async ({ ack, body, client, action }) => {
  await ack();
  if (await denyIfNotAdmin(body, client)) return;
  const p = { ...ui.unpack(action.value), dm: body.channel.id, dmTs: body.message.ts };
  await client.views.open({ trigger_id: body.trigger_id, view: ui.approveRequestModal(config, p) });
});

// Entering the website refills the source list with that site's likely pages. A new block_id makes
// Slack show the new suggestion instead of keeping what was typed before.
app.action('website', async ({ ack, body, client }) => {
  await ack();
  const view = body.view;
  const p = ui.unpack(view.private_metadata);
  p.web = view.state.values.website.website.value?.trim() || null;
  p.name = view.state.values.name.v.value?.trim() || p.name;
  await client.views.update({ view_id: view.id, hash: view.hash, view: ui.approveRequestModal(config, p, `sources_${Date.now()}`) });
});

app.view('approve_request_submit', async ({ ack, body, view, client }) => {
  const v = view.state.values;
  const p = ui.unpack(view.private_metadata);
  const name = v.name.v.value.trim();
  const category = v.category.v.selected_option.value;
  const website = v.website.website.value?.trim();
  const sourcesBlock = Object.keys(v).find((k) => k.startsWith('sources'));
  const { sources, errors } = ui.parseSources(v[sourcesBlock].v.value ?? '');
  if (errors.length || !sources.length) {
    await ack({ response_action: 'errors', errors: { [sourcesBlock]: errors[0] ?? 'Add at least one source' } });
    return;
  }
  await ack();

  const approver = await displayName(client, body.user.id);
  const requester = await displayName(client, p.u);
  const slug = slugify(name);
  const request = {
    id: p.id, kind: 'battlecard', name, slug, category,
    requestedBy: p.u, requestedByName: requester, requestedAt: isoDate(), reason: p.reason || null,
    channel: p.c, status: 'approved', decidedBy: approver, decidedAt: isoDate(),
  };
  try {
    await kb.createDraftCard(
      emptyCard({ slug, name, category, website, sources, requestedBy: requester, approvedBy: approver, capabilities: categoryById(config, category).capabilities }),
      request,
    );
    await dispatchWorkflow('draft-card.yml', { slug });
  } catch (err) {
    await client.chat.postMessage({ channel: body.user.id, text: `Couldn't start the ${name} battlecard: ${err.message}` });
    return;
  }

  await client.chat.update({
    channel: p.dm,
    ts: p.dmTs,
    text: 'Approved',
    blocks: ui.decidedBlocks(`:white_check_mark: Approved *${name}* in ${categoryById(config, category).name} with ${sources.length} source(s)`, 'Claude is drafting the card now. You\'ll get a pull request to review; merging it publishes the card and announces it in the channel.'),
  });
  await client.chat.postMessage({ channel: p.u, text: `Your battlecard request for *${name}* was approved. It's being drafted now, and I'll post the link when it's live.` });
});

app.action('reject_request', async ({ ack, body, client, action }) => {
  await ack();
  if (await denyIfNotAdmin(body, client)) return;
  const p = { ...ui.unpack(action.value), dm: body.channel.id, dmTs: body.message.ts };
  await client.views.open({ trigger_id: body.trigger_id, view: ui.reasonModal('reject_request_submit', 'Reject request', p, 'Reason, sent to the rep (optional)') });
});

app.view('reject_request_submit', async ({ ack, body, view, client }) => {
  await ack();
  const p = ui.unpack(view.private_metadata);
  const reason = view.state.values.reason.v.value?.trim();
  await kb.logRequest({
    id: p.id, kind: 'battlecard', name: p.name, slug: slugify(p.name), requestedBy: p.u, requestedAt: isoDate(), reason: p.reason || null,
    status: 'rejected', decidedBy: await displayName(client, body.user.id), decidedAt: isoDate(), decisionNote: reason || null,
  });
  await client.chat.postMessage({ channel: p.u, text: `Your battlecard request for *${p.name}* wasn't approved.${reason ? `\n>${reason}` : ''}\nIf something changes, post what you're seeing in #${config.slack.intelChannel}.` });
  await client.chat.update({ channel: p.dm, ts: p.dmTs, text: 'Rejected', blocks: ui.decidedBlocks(`:x: Rejected the *${p.name}* request`, reason) });
});

// ---------------------------------------------------------------------------
// 4. Admin buttons sent by the scheduled jobs
// ---------------------------------------------------------------------------
app.action('publish_update', async ({ ack, body, client, action }) => {
  await ack();
  if (await denyIfNotAdmin(body, client)) return;
  const update = await kb.publishUpdate(action.value, isoDate());
  const channel = await resolveIntelChannel(client);
  const target = config.slack.updatesChannel === config.slack.intelChannel ? channel : config.slack.updatesChannel;
  await client.chat.postMessage({ channel: target, text: update.title, blocks: ui.updateChannelBlocks(config, update), unfurl_links: false });
  await client.chat.update({ channel: body.channel.id, ts: body.message.ts, text: 'Published', blocks: ui.decidedBlocks(`:white_check_mark: Published *${update.title}* to #${config.slack.updatesChannel}`) });
});

app.action('confirm_card', async ({ ack, body, client, action }) => {
  await ack();
  if (await denyIfNotAdmin(body, client)) return;
  await kb.confirmCard(action.value, isoDate(), await displayName(client, body.user.id));
  await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: `Marked ${action.value} as current.` }).catch(() => {});
});

// Link buttons still send an action; acknowledge them so Slack doesn't show an error.
app.action('open_update', async ({ ack }) => ack());

app.error(async (err) => console.error(err));

await app.start(Number(process.env.PORT) || 3000);
console.log(`Competitive Intel Tracker bot running (${socketMode ? 'Socket Mode' : 'HTTP'})${hasKey() ? '' : ' without a Claude key'}`);
