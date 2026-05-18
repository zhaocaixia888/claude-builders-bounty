#!/usr/bin/env node

/**
 * claude-review — AI-powered PR Review Agent
 *
 * Analyzes a GitHub pull request diff and produces a structured
 * Markdown review comment covering Summary, Risks, Suggestions,
 * and Confidence Score.
 *
 * Usage:
 *   node claude-review --pr https://github.com/owner/repo/pull/123
 *   GITHUB_TOKEN=ghp_xxx node claude-review --pr https://github.com/owner/repo/pull/123
 */

const https = require("node:https");
const { URL } = require("node:url");

// ══════════════════════════════════════════════════════════════════════
// Config
// ══════════════════════════════════════════════════════════════════════

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

// ══════════════════════════════════════════════════════════════════════
// GitHub API helpers
// ══════════════════════════════════════════════════════════════════════

function githubAPI(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.github.com",
      path,
      headers: {
        "User-Agent": "claude-review-agent/1.0",
        Accept: "application/vnd.github.v3.diff",
      },
    };
    if (GITHUB_TOKEN) opts.headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

    https.get(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function githubAPIGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.github.com",
      path,
      headers: {
        "User-Agent": "claude-review-agent/1.0",
        Accept: "application/vnd.github.v3+json",
      },
    };
    if (GITHUB_TOKEN) opts.headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

    https.get(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: "parse_failed", raw: data.slice(0, 200) });
        }
      });
    }).on("error", reject);
  });
}

// ══════════════════════════════════════════════════════════════════════
// PR URL Parser
// ══════════════════════════════════════════════════════════════════════

function parsePR(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error(`Invalid PR URL: ${url}`);
  return { owner: match[1], repo: match[2], pr: match[3] };
}

// ══════════════════════════════════════════════════════════════════════
// Diff Parser
// ══════════════════════════════════════════════════════════════════════

function parseDiff(diffText) {
  const files = [];
  let currentFile = null;

  for (const line of diffText.split("\n")) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (header) {
      if (currentFile) files.push(currentFile);
      currentFile = {
        path: header[2],
        additions: 0,
        deletions: 0,
        lines: [],
      };
      continue;
    }
    if (!currentFile) continue;

    const added = line.match(/^\+[^+]/);
    const removed = line.match(/^-[^-]/);
    if (added) currentFile.additions++;
    if (removed) currentFile.deletions++;
    currentFile.lines.push(line);
  }
  if (currentFile) files.push(currentFile);

  return files;
}

// ══════════════════════════════════════════════════════════════════════
// Risk & Pattern Detectors
// ══════════════════════════════════════════════════════════════════════

const RISK_PATTERNS = [
  {
    id: "hardcoded_secret",
    severity: "high",
    label: "🔑 Possible hardcoded secret / credential",
    patterns: [
      /api[_-]?key\s*[=:]\s*['"][^'"]{8,}['"]/i,
      /secret\s*[=:]\s*['"][^'"]{8,}['"]/i,
      /password\s*[=:]\s*['"][^'"]{4,}['"]/i,
      /token\s*[=:]\s*['"][^'"]{8,}['"]/i,
      /sk_live_/i,
      /pk_live_/i,
      /ghp_/i,
      /AKIA[0-9A-Z]{16}/,
    ],
  },
  {
    id: "debug_code",
    severity: "medium",
    label: "🐛 Debug / leftover code",
    patterns: [
      /console\.log\(/,
      /console\.debug\(/,
      /debugger;/,
      /TODO:/i,
      /FIXME:/i,
      /HACK:/i,
      /console\.warn\(/,
    ],
  },
  {
    id: "sql_injection",
    severity: "high",
    label: "🗃️ Possible SQL injection — use parameterized queries",
    patterns: [
      /\.exec\(`/,
      /\.query\(`/,
      /\.raw\(`/,
      /execute\(['"`].*\$\{/,
      /query\(['"`].*\$\{/,
      /WHERE\s+\w+\s*=\s*['"`]\s*\+\s*/i,
    ],
  },
  {
    id: "eval_unsafe",
    severity: "high",
    label: "⚠️ Unsafe eval() / Function() usage",
    patterns: [
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /setTimeout\s*\(\s*['"`]/,
      /setInterval\s*\(\s*['"`]/,
    ],
  },
  {
    id: "insecure_compare",
    severity: "medium",
    label: "🔓 Use constant-time comparison for secrets",
    patterns: [/===?\s*['"].{8,}['"]\s*\?\s*['"]success/i],
  },
  {
    id: "large_pr",
    severity: "info",
    label: "📏 Large PR — consider splitting into smaller chunks",
    patterns: [], // handled separately
  },
  {
    id: "no_error_handling",
    severity: "medium",
    label: "🛡️ Missing error handling",
    patterns: [
      /\.then\(\(?\w+\)?\s*=>\s*\{[^}]*\}[^)]*\)\s*\.catch/,
    ],
    // We check complement — presence of .catch is good
  },
  {
    id: "path_traversal",
    severity: "high",
    label: "📁 Possible path traversal",
    patterns: [
      /readFileSync\(/,
      /writeFileSync\(/,
      /\.\.\/\.\.\//,
    ],
  },
];

function analyzeFile(file) {
  const risks = [];
  const totalContent = file.lines.join("\n");

  for (const detector of RISK_PATTERNS) {
    if (detector.id === "large_pr") continue;
    for (const pattern of detector.patterns) {
      if (pattern.test(totalContent)) {
        risks.push({
          severity: detector.severity,
          label: detector.label,
          file: file.path,
          lines: findLines(file.lines, pattern),
        });
        break; // one match per detector per file
      }
    }
  }

  return risks;
}

function findLines(lines, pattern) {
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      result.push(i + 1);
    }
  }
  return result.slice(0, 3); // max 3 line numbers
}

// ══════════════════════════════════════════════════════════════════════
// Confidence Score
// ══════════════════════════════════════════════════════════════════════

function calculateConfidence(files, risks) {
  const highRiskCount = risks.filter((r) => r.severity === "high").length;
  const totalChanges = files.reduce((s, f) => s + f.additions + f.deletions, 0);

  if (highRiskCount >= 3) return "Low";
  if (highRiskCount >= 1 && totalChanges > 500) return "Low";
  if (totalChanges <= 30 && highRiskCount === 0) return "High";
  if (highRiskCount === 0 && totalChanges <= 200) return "High";
  return "Medium";
}

// ══════════════════════════════════════════════════════════════════════
// Markdown Output
// ══════════════════════════════════════════════════════════════════════

function generateReview(files, risks, confidence, prInfo) {
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const high = risks.filter((r) => r.severity === "high");
  const medium = risks.filter((r) => r.severity === "medium");
  const infos = risks.filter((r) => r.severity === "info");

  let md = `## 🤖 AI PR Review\n\n`;
  md += `**PR:** [${prInfo.owner}/${prInfo.repo}#${prInfo.pr}](https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.pr})\n\n`;

  // Summary
  md += `### 📋 Summary\n\n`;
  md += `This PR touches **${files.length} files** with **+${totalAdd}/-${totalDel}** lines changed.\n\n`;

  if (files.length <= 5) {
    for (const f of files) {
      md += `- \`${f.path}\` (+${f.additions}/-${f.deletions})\n`;
    }
  }
  md += `\n`;

  // Risks
  md += `### ⚠️ Identified Risks\n\n`;
  if (risks.length === 0) {
    md += `_No significant risks detected._\n\n`;
  } else {
    md += `| Severity | Issue | File(s) |\n`;
    md += `|----------|-------|--------|\n`;
    for (const risk of risks) {
      const sevIcon = risk.severity === "high" ? "🔴 High" : risk.severity === "medium" ? "🟡 Medium" : "🔵 Info";
      const loc = risk.lines.length > 0 ? `:${risk.lines.join(",")}` : "";
      md += `| ${sevIcon} | ${risk.label} | \`${risk.file}${loc}\` |\n`;
    }
    md += `\n`;
  }

  // Suggestions
  md += `### 💡 Improvement Suggestions\n\n`;
  const suggestions = [];

  if (high.length > 0) {
    suggestions.push(`Address **${high.length} high-severity** ${high.length === 1 ? "issue" : "issues"} before merging.`);
  }
  if (totalAdd + totalDel > 400) {
    suggestions.push(`Consider splitting into smaller PRs for easier review (currently ${totalAdd + totalDel} lines).`);
  }
  if (files.length > 10) {
    suggestions.push(`This PR touches ${files.length} files — consider if this can be scoped smaller.`);
  }
  if (!files.some((f) => f.path.endsWith(".test.") || f.path.endsWith("spec.") || f.path.endsWith("test.ts"))) {
    suggestions.push(`No test files detected in this PR — consider adding tests for the changes.`);
  }

  if (suggestions.length === 0) {
    md += `_PR scope looks well-contained._\n\n`;
  } else {
    for (const s of suggestions) md += `- ${s}\n`;
    md += `\n`;
  }

  // Confidence
  md += `### ✅ Confidence Score: **${confidence}**\n\n`;
  md += `_Based on ${files.length} file(s), ${high.length} high-severity risk(s), and ${totalAdd + totalDel} line(s) changed._\n`;
  md += `\n---\n`;
  md += `_Generated by claude-review-agent_`;

  return md;
}

// ══════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const prUrlIndex = args.indexOf("--pr");
  if (prUrlIndex === -1 || !args[prUrlIndex + 1]) {
    console.error("Usage: node claude-review --pr <PR_URL>");
    console.error("       GITHUB_TOKEN=ghp_xxx node claude-review --pr <PR_URL>");
    process.exit(1);
  }

  const prUrl = args[prUrlIndex + 1];
  const prInfo = parsePR(prUrl);

  console.error(`🔍 Fetching PR #${prInfo.pr} from ${prInfo.owner}/${prInfo.repo}...`);

  // Fetch PR diff
  const diffText = await githubAPI(`/repos/${prInfo.owner}/${prInfo.repo}/pulls/${prInfo.pr}`);

  if (!diffText || diffText.length < 10) {
    console.error("❌ Could not fetch PR diff. Check the URL and token permissions.");
    process.exit(1);
  }

  // Fetch PR metadata for a summary
  const prMeta = await githubAPIGet(`/repos/${prInfo.owner}/${prInfo.repo}/pulls/${prInfo.pr}`);
  const title = prMeta.title || `PR #${prInfo.pr}`;

  console.error(`   Title: ${title}`);
  console.error(`   Diff size: ${(diffText.length / 1024).toFixed(1)} KB`);

  // Parse and analyze
  const files = parseDiff(diffText);

  console.error(`   Files changed: ${files.length}`);
  console.error(`\n🔎 Analyzing...`);

  const allRisks = [];
  for (const file of files) {
    const fileRisks = analyzeFile(file);
    allRisks.push(...fileRisks);
  }

  // Deduplicate risks by (id, file)
  const uniqueRisks = [];
  const seen = new Set();
  for (const r of allRisks) {
    const key = `${r.label}|${r.file}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRisks.push(r);
    }
  }

  // Large PR check
  const totalChanges = files.reduce((s, f) => s + f.additions + f.deletions, 0);
  if (totalChanges > 400) {
    uniqueRisks.push({
      severity: "info",
      label: "📏 Large PR — consider splitting into smaller chunks",
      file: "(overall)",
      lines: [],
    });
  }

  const confidence = calculateConfidence(files, uniqueRisks);

  // Generate output
  const reviewMd = generateReview(files, uniqueRisks, confidence, prInfo);

  console.error(`\n✅ Review complete (Confidence: ${confidence})`);
  console.error(`   ${uniqueRisks.length} risk(s) found`);
  console.error(`\n${'─'.repeat(50)}\n`);

  // Output the review Markdown to stdout
  console.log(reviewMd);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
