// Reads and commits knowledge-base files through the GitHub REST API. The Slack bot uses this, so an
// approval in Slack becomes a commit with an author, a date and a message, and the site rebuilds itself.

const API = 'https://api.github.com';

function repo() {
  const r = process.env.GITHUB_REPOSITORY;
  if (!r) throw new Error('GITHUB_REPOSITORY (owner/name) is not set');
  return r;
}

async function gh(method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${method} ${url} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}

const branch = () => process.env.GITHUB_BRANCH || 'main';

export async function readFile(filePath) {
  const data = await gh('GET', `/repos/${repo()}/contents/${filePath}?ref=${branch()}`);
  if (!data) return null;
  return { sha: data.sha, text: Buffer.from(data.content, 'base64').toString('utf8') };
}

export async function readJsonFile(filePath, fallback = null) {
  const f = await readFile(filePath);
  return f ? { sha: f.sha, data: JSON.parse(f.text) } : { sha: null, data: fallback };
}

export async function writeFile(filePath, text, message, sha) {
  return gh('PUT', `/repos/${repo()}/contents/${filePath}`, {
    message,
    content: Buffer.from(text).toString('base64'),
    branch: branch(),
    ...(sha ? { sha } : {}),
  });
}

/**
 * Read-modify-write with a retry on conflict, so two approvals landing at once don't clobber each other.
 * `mutate` receives the parsed JSON (or the fallback) and returns the new value.
 */
export async function updateJsonFile(filePath, fallback, mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await readJsonFile(filePath, fallback);
    const next = await mutate(structuredClone(data));
    try {
      await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, message, sha);
      return next;
    } catch (err) {
      if (!String(err.message).includes('409') && !String(err.message).includes('422')) throw err;
    }
  }
  throw new Error(`Could not update ${filePath} after 3 attempts`);
}

// Starts a GitHub Actions workflow, e.g. drafting a new battlecard after the admin approves a request.
export async function dispatchWorkflow(workflowFile, inputs) {
  return gh('POST', `/repos/${repo()}/actions/workflows/${workflowFile}/dispatches`, { ref: branch(), inputs });
}
