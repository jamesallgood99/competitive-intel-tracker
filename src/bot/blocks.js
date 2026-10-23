// Slack Block Kit layouts used by the bot.
import { cardUrl, updateUrl } from '../lib/config.js';
import { prettyMonth } from '../lib/dates.js';

const text = (t) => ({ type: 'mrkdwn', text: t });
const plain = (t) => ({ type: 'plain_text', text: t, emoji: false });
const btn = (label, action_id, value, style) => ({ type: 'button', text: plain(label), action_id, value, ...(style ? { style } : {}) });

// Slack caps button values at 2000 characters; keep the payload compact.
export const pack = (o) => JSON.stringify(o).slice(0, 1990);
export const unpack = (s) => JSON.parse(s);

export function cardBlocks(config, card) {
  return [
    { type: 'section', text: text(`*<${cardUrl(config, card.slug)}|${card.name} battlecard>*\n>${card.positioning || '_Positioning not written yet._'}`) },
    {
      type: 'context',
      elements: [text(`${card.scorecard.filter((s) => s.verdict === 'win').length} wins, ${card.scorecard.filter((s) => s.verdict === 'loss').length} losses on the quick look · confirmed ${card.lastConfirmed ?? 'never'}`)],
    },
  ];
}

export function intelReviewBlocks(config, { triage, card, rep, permalink, original, payload }) {
  return [
    { type: 'header', text: plain('Competitive intel to review') },
    {
      type: 'section',
      text: text(`*${card ? `<${cardUrl(config, card.slug)}|${card.name}>` : 'Unmatched competitor'}* · ${triage.type} · ${triage.severity}\nFrom <@${rep}> in <${permalink}|this message>`),
    },
    { type: 'section', text: text(`*Proposed for the battlecard:*\n${triage.summary}`) },
    { type: 'context', elements: [text(`Original: ${original.length > 280 ? `${original.slice(0, 277)}...` : original}`)] },
    ...(triage.needsSource ? [{ type: 'context', elements: [text(':warning: No source given. Consider asking the rep before approving.')] }] : []),
    {
      type: 'actions',
      block_id: 'intel_review',
      elements: [
        btn('Approve', 'approve_intel', pack(payload), 'primary'),
        btn('Edit and approve', 'edit_intel', pack(payload)),
        btn('Reject', 'reject_intel', pack(payload), 'danger'),
      ],
    },
  ];
}

export function decidedBlocks(summaryLine, detail) {
  return [{ type: 'section', text: text(summaryLine) }, ...(detail ? [{ type: 'context', elements: [text(detail)] }] : [])];
}

export function editIntelModal(config, competitors, payload) {
  const options = competitors
    .filter((c) => c.status === 'active')
    .map((c) => ({ text: plain(c.name.slice(0, 75)), value: c.slug }));
  const initial = options.find((o) => o.value === payload.slug);
  return {
    type: 'modal',
    callback_id: 'edit_intel_submit',
    private_metadata: pack(payload),
    title: plain('Edit field intel'),
    submit: plain('Approve'),
    close: plain('Cancel'),
    blocks: [
      {
        type: 'input',
        block_id: 'competitor',
        label: plain('Competitor'),
        element: { type: 'static_select', action_id: 'v', options, ...(initial ? { initial_option: initial } : {}) },
      },
      {
        type: 'input',
        block_id: 'text',
        label: plain('What goes on the battlecard'),
        element: { type: 'plain_text_input', action_id: 'v', multiline: true, initial_value: payload.sum },
      },
      {
        type: 'input',
        block_id: 'severity',
        label: plain('How big is this?'),
        element: {
          type: 'radio_buttons',
          action_id: 'v',
          initial_option: { text: plain(payload.sev === 'major' ? 'Major: changes how we sell' : 'Minor'), value: payload.sev === 'major' ? 'major' : 'minor' },
          options: [
            { text: plain('Major: changes how we sell'), value: 'major' },
            { text: plain('Minor'), value: 'minor' },
          ],
        },
      },
    ],
  };
}

export function reasonModal(callback_id, title, payload, label) {
  return {
    type: 'modal',
    callback_id,
    private_metadata: pack(payload),
    title: plain(title),
    submit: plain('Reject'),
    close: plain('Cancel'),
    blocks: [
      {
        type: 'input',
        block_id: 'reason',
        optional: true,
        label: plain(label),
        element: { type: 'plain_text_input', action_id: 'v', multiline: true },
      },
    ],
  };
}

export function requestReviewBlocks({ name, reason, rep, payload }) {
  return [
    { type: 'header', text: plain('New battlecard request') },
    { type: 'section', text: text(`<@${rep}> asked for a battlecard on *${name}*.${reason ? `\n>${reason}` : ''}`) },
    { type: 'context', elements: [text('Approving opens a form where you choose the category and approve the pages and searches the tracker may use.')] },
    {
      type: 'actions',
      elements: [btn('Approve and set sources', 'approve_request', pack(payload), 'primary'), btn('Reject', 'reject_request', pack(payload), 'danger')],
    },
  ];
}

// Suggested sources for a new competitor. The admin edits this list before anything is fetched.
export function suggestedSources(name, website) {
  const lines = [];
  if (website) {
    const base = website.replace(/\/$/, '');
    lines.push(`fetch messaging ${base}/`, `fetch products ${base}/products`, `fetch compliance ${base}/security`);
  }
  lines.push(`search reviews ${name} reviews G2 Capterra Gartner`, `search employees ${name} Glassdoor reviews CEO approval`);
  return lines.join('\n');
}

export function parseSources(textBlock) {
  const methods = new Set(['fetch', 'search', 'upload', 'api']);
  const purposes = new Set(['messaging', 'products', 'compliance', 'reviews', 'employees']);
  const sources = [];
  const errors = [];
  textBlock
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const [method, purpose, ...rest] = line.split(/\s+/);
      const url = rest.join(' ');
      if (!methods.has(method) || !purposes.has(purpose) || !url) {
        errors.push(`Line ${i + 1} should look like "fetch products https://..." or "search reviews <query>"`);
      } else if (method === 'fetch' && !/^https?:\/\//.test(url)) {
        errors.push(`Line ${i + 1}: a fetch source needs a full URL`);
      } else {
        sources.push({ url, method, purpose });
      }
    });
  return { sources, errors };
}

export function approveRequestModal(config, payload, sourcesBlockId = 'sources') {
  const categories = config.categories.map((c) => ({ text: plain(c.name), value: c.id }));
  return {
    type: 'modal',
    callback_id: 'approve_request_submit',
    private_metadata: pack(payload),
    title: plain('Approve battlecard'),
    submit: plain('Approve and draft'),
    close: plain('Cancel'),
    blocks: [
      { type: 'input', block_id: 'name', label: plain('Company name'), element: { type: 'plain_text_input', action_id: 'v', initial_value: payload.name } },
      { type: 'input', block_id: 'category', label: plain('Competitive category'), element: { type: 'static_select', action_id: 'v', options: categories } },
      {
        type: 'input',
        block_id: 'website',
        dispatch_action: true,
        label: plain('Website'),
        hint: plain('Press Enter to fill in suggested pages below. Check the paths before approving.'),
        element: { type: 'url_text_input', action_id: 'website', dispatch_action_config: { trigger_actions_on: ['on_enter_pressed'] }, ...(payload.web ? { initial_value: payload.web } : {}) },
      },
      {
        type: 'input',
        block_id: sourcesBlockId,
        label: plain('Approved sources, one per line'),
        hint: plain('method purpose target. Methods: fetch (a page on their site), search (web search), upload, api. Purposes: messaging, products, compliance, reviews, employees. Review sites are never fetched directly.'),
        element: { type: 'plain_text_input', action_id: 'v', multiline: true, initial_value: suggestedSources(payload.name, payload.web) },
      },
    ],
  };
}

export function updateChannelBlocks(config, u) {
  return [
    { type: 'header', text: plain(`${prettyMonth(u.id)} competitive update`) },
    { type: 'section', text: text(`*${u.title}*\n\n*TL;DR*\n${u.tldr.map((t, i) => `${i + 1}. ${t.text}${t.slug ? ` <${cardUrl(config, t.slug)}|Battlecard>` : ''}`).join('\n')}`) },
    {
      type: 'section',
      text: text(
        u.categories
          .map((c) => `*${c.name}:* ${c.movers.length ? c.movers.map((m) => `<${cardUrl(config, m.slug)}|${m.name}>`).join(', ') : 'quiet'}`)
          .join('\n'),
      ),
    },
    { type: 'actions', elements: [{ type: 'button', text: plain('Read the full update'), url: updateUrl(config, u.id), action_id: 'open_update' }] },
  ];
}
