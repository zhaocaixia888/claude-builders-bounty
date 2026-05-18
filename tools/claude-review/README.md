# claude-review — AI PR Review Agent

A CLI tool and GitHub Action that analyzes GitHub pull request diffs and generates structured Markdown reviews.

## Features

- 🔍 Fetches PR diff via GitHub API
- ⚠️ Detects security risks: hardcoded secrets, SQL injection, eval(), path traversal
- 🔬 Catches code quality issues: debug leftovers, missing error handling
- 📏 Flags oversized PRs and missing tests
- ✅ Confidence scoring (Low / Medium / High)
- 📝 Generates structured Markdown with Summary, Risks, Suggestions, and Confidence

## CLI Usage

```bash
# Install (clone this repo)
node claude-review --pr https://github.com/owner/repo/pull/123

# With authentication (recommended — higher rate limits)
GITHUB_TOKEN=ghp_xxx node claude-review --pr https://github.com/owner/repo/pull/123
```

## Sample Output

```
## 🤖 AI PR Review

PR: owner/repo#123

### 📋 Summary
This PR touches 4 files with +202/-7 lines changed.

### ⚠️ Identified Risks
| Severity | Issue | File |
|----------|-------|------|
| 🔴 High | 🔑 Possible hardcoded secret | src/config.js:15 |
| 🟡 Medium | 🐛 Debug / leftover console.log | src/utils.js:42 |

### 💡 Improvement Suggestions
- Address 1 high-severity issue before merging.
- No test files detected — consider adding tests.

### ✅ Confidence Score: High
```

## GitHub Action

Add `.github/workflows/claude-review.yml` to your repo:

```yaml
name: Claude Code PR Review
on:
  issue_comment:
    types: [created]
jobs:
  review:
    if: github.event.comment.body == '/claude-review'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run claude-review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npx https://raw.githubusercontent.com/your-username/repo/main/claude-review.js \
            --pr "${{ github.event.issue.pull_request.html_url }}"
```

## Requirements

- Node.js 18+
- GitHub token (optional but recommended for higher API rate limits)

## Tested On

See [`sample_outputs/`](./sample_outputs/) for real PR review outputs.
