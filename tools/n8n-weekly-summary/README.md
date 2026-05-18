# Weekly GitHub Dev Summary — n8n Workflow

A complete n8n workflow that generates a weekly narrative summary of your GitHub repository's activity using the Claude API.

![Workflow Overview](./screenshot.png)

## Setup (5 Steps)

### 1. Import the Workflow

1. Open your n8n instance (cloud or self-hosted)
2. Go to **Workflows** → **Add Workflow** → **Import from File**
3. Select `weekly-github-summary.workflow.json`

### 2. Create Credentials

In n8n, go to **Settings** → **Credentials** and add:

| Credential | Type | Value |
|-----------|------|-------|
| **GitHub Token** | Header Auth | `Authorization: Bearer ghp_xxx` (your [GitHub PAT](https://github.com/settings/tokens) with `repo` scope) |
| **Claude API Key** | Header Auth | `x-api-key: sk-ant-xxx` (your [Anthropic API key](https://console.anthropic.com/)) |

### 3. Configure Workflow Variables

Open the workflow and set these variables (click the **Workflow** tab → **Workflow Variables**):

| Variable | Example | Description |
|----------|---------|-------------|
| `GitHubRepo` | `owner/repo-name` | The GitHub repository to summarize |
| `GitHubTokenName` | `GitHub Token` | Name of the GitHub credential in n8n |
| `ClaudeTokenName` | `Claude API Key` | Name of the Claude credential in n8n |
| `WebhookURL` | `https://discord.com/api/webhooks/...` | Discord/Slack webhook URL for delivery |
| `Language` | `EN` | Output language: `EN` or `FR` |
| `LastFriday` | `2026-05-15T00:00:00Z` | (Auto-calculated) Date for the weekly window |

### 4. Activate the Workflow

Toggle the workflow to **Active**. It will run every Friday at 5 PM.

### 5. Test It Manually

Click **Execute Workflow** to test immediately. You should see:
1. GitHub data fetched (commits, issues, PRs)
2. Claude generates a narrative summary
3. Summary delivered to your webhook

## Sample Output

```
📊 **Weekly Dev Summary — owner/repo-name**

This week saw significant progress on the payment system integration.
The team merged 5 PRs, with the Stripe PaymentIntent implementation being
the standout feature. Key improvements include...

_Generated on 2026-05-18_
```

## Configuration

### Cron Schedule
The workflow runs every Friday at 5 PM by default. To change this, edit the **Schedule Trigger** node's cron expression.

### Language Support
- `EN` — English output (default)
- `FR` — French output

### Delivery Channels
The workflow sends to a generic webhook URL. Supported destinations:
- **Discord**: Create a webhook in your server's channel settings
- **Slack**: Create an Incoming Webhook app
- **Email**: Use n8n's built-in email node (modify the workflow)
