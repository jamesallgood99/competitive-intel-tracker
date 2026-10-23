// Minimal Claude Messages API client. No SDK, so the jobs and the bot share one small dependency-free file.
import { model as configuredModel } from './config.js';

const API = 'https://api.anthropic.com/v1/messages';
export const WEB_SEARCH_TOOL = { type: 'web_search_20260318', name: 'web_search', max_uses: 6 };

export function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function post(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Runs one request to completion, following pause_turn when server tools such as web search are used.
 * Returns the concatenated text and every URL Claude cited.
 */
export async function ask(config, { system, prompt, webSearch = false, maxTokens = 4000 }) {
  if (!hasKey()) throw new Error('ANTHROPIC_API_KEY is not set');
  const messages = [{ role: 'user', content: prompt }];
  const tools = webSearch ? [WEB_SEARCH_TOOL] : undefined;
  let text = '';
  const citations = new Map();

  for (let i = 0; i < 5; i++) {
    const res = await post({ model: configuredModel(config), max_tokens: maxTokens, system, messages, tools });
    for (const block of res.content) {
      if (block.type !== 'text') continue;
      text += block.text;
      for (const c of block.citations ?? []) if (c.url) citations.set(c.url, c.title ?? c.url);
    }
    if (res.stop_reason !== 'pause_turn') break;
    // Send the paused turn back unchanged so the server tool can finish.
    messages.push({ role: 'assistant', content: res.content });
  }
  return { text, citations: [...citations].map(([url, title]) => ({ url, title })) };
}

// Pulls the first JSON object or array out of a model reply (tolerates a code fence or a lead-in line).
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error('No JSON found in model reply');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error('Unterminated JSON in model reply');
}

export async function askJson(config, opts) {
  const { text, citations } = await ask(config, opts);
  return { data: parseJson(text), citations };
}
