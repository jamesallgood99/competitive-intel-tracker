# Slack setup

About 20 minutes. You need to be able to install apps in your Slack workspace and add secrets to the
GitHub repo.

## 1. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**.
2. Pick your workspace and paste in `slack/manifest.yml`. It sets up Socket Mode, so the bot needs no
   public URL.
3. **Install to Workspace.** Copy the **Bot User OAuth Token** (`xoxb-...`).
4. Under **Basic Information → App-Level Tokens**, create a token with the `connections:write` scope. Copy
   it (`xapp-...`).
5. Create **#competitive-intel** (or whatever you set as `slack.intelChannel`) and invite the bot:
   `/invite @Intel`.
6. Find each admin's member ID (profile → ⋮ → **Copy member ID**) and put them in
   `slack.adminUserIds` in `config/tracker.config.json`. The first admin gets intel reviews, change alerts
   and monthly drafts.

## 2. Give the bot access to the repo

The bot reads battlecards from GitHub and commits every approval, so it needs a token.

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
limited to this repository, with:

- **Contents:** read and write (to commit approved intel and new cards)
- **Actions:** read and write (to start the card-drafting workflow)

Commits made with this token trigger the site rebuild, which the default Actions token can't do.

## 3. Run the bot

The bot needs these environment variables:

| Variable | Value |
|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-...` from step 1.3 |
| `SLACK_APP_TOKEN` | `xapp-...` from step 1.4 |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) |
| `GITHUB_TOKEN` | The token from step 2 |
| `GITHUB_REPOSITORY` | `your-org/competitive-intel-tracker` |
| `CLAUDE_MODEL` | Optional. Defaults to the model in the config. |

**Locally**, to try it:

```bash
npm install
export SLACK_BOT_TOKEN=... SLACK_APP_TOKEN=... ANTHROPIC_API_KEY=... GITHUB_TOKEN=... GITHUB_REPOSITORY=...
npm run bot
```

**Hosted**, so it's always on. Socket Mode keeps one outbound connection open, so any host that runs a
container works. With [Fly.io](https://fly.io):

```bash
fly launch --copy-config --no-deploy
fly secrets set SLACK_BOT_TOKEN=... SLACK_APP_TOKEN=... ANTHROPIC_API_KEY=... GITHUB_TOKEN=... GITHUB_REPOSITORY=...
fly deploy
```

The `Dockerfile` works the same way on Render, Railway or Cloud Run (set minimum instances to 1).

## 4. Secrets for the scheduled jobs

In the GitHub repo, **Settings → Secrets and variables → Actions**, add:

- `ANTHROPIC_API_KEY`
- `SLACK_BOT_TOKEN`

Optionally add a repository variable `CLAUDE_MODEL`.

## 5. Check it works

1. In #competitive-intel, post something like: "Heard on a call that Watchpost now bundles Ergo for free
   on three-year deals." The bot reacts with 👀 and replies in the thread. The admin gets a review DM.
2. Approve it. The rep's message gets a ✅, and the card shows the intel after the site rebuilds.
3. Type `/battlecard watchpost`.
4. In GitHub, **Actions → Monthly competitive update → Run workflow** drafts an update now and sends it
   to the admin.
