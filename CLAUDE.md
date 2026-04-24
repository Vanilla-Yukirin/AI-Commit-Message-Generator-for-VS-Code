# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension that calls an OpenAI-compatible (or Claude) chat endpoint to generate a Conventional Commits message from the repo's staged (fallback: unstaged) `git diff`, and writes the result into the Source Control input box.

Fork lineage: original upstream is [komiyamma/vscode_extension_commit_message_gene_by_gemini_cli](https://github.com/komiyamma/vscode_extension_commit_message_gene_by_gemini_cli), then [venberstep/AI-Commit-Message-Generator-for-VS-Code](https://github.com/venberstep/AI-Commit-Message-Generator-for-VS-Code), now a self-use fork under publisher `venberstep-vanilla`. The fork is not published to Marketplace — distribution is local VSIX only.

## Commands

```bash
npm ci                      # install deps (clean)
npm run compile             # tsc -p ./  → emits out/
npm run watch               # tsc --watch
npm run lint                # eslint src
npm test                    # vscode-test (spawns a VS Code instance)
npx @vscode/vsce package    # build ai-commit-message-<version>.vsix at repo root
```

F5 in VS Code launches an "Extension Development Host" with this extension loaded — preferred inner loop. Install a built `.vsix` via Extensions view → `···` → **Install from VSIX**.

A single test file [src/test/extension.test.ts](src/test/extension.test.ts) exists but is a scaffold; there is no real test coverage. `npm run pretest` chains `compile + lint`.

Release workflow [.github/workflows/release.yml](.github/workflows/release.yml) is tag-driven (`v*.*.*`) and publishes a GitHub Release with the VSIX.

## Architecture

Four source files, each with a focused role — read them in this order to understand a change:

1. **[src/extension.ts](src/extension.ts)** — activation + command handler. Owns the user-facing flow:
   - Registers `ai-commit-message.generate` (SCM title-bar wand icon) and `ai-commit-message.clearApiKey`
   - Runs: config check → secrets-backed API key retrieval → `QuickPick` mode selection (Chinese / English / Custom) → optional custom sub-flow (truncate? language? extra instructions?) → call `generateCommitMessage` → write to commit input box via `vscode.git` extension API (fallback: `vscode.scm.inputBox`)
   - Output channel named "commit message gene" is the streaming surface; the SCM input box only receives the final accumulated text.

2. **[src/api.ts](src/api.ts)** — all network I/O. Two code paths (`callClaudeAPI`, `callOpenAICompatibleAPI`) both stream SSE through a shared `readSSEStream`. Parsers return `{ text?, thinking? }`; `onChunk(chunk, kind)` routes them to the caller. **Thinking is never accumulated into the returned string** — it's display-only, so it can't leak into the commit message. `parseOpenAIChunk` reads `delta.content`, `delta.reasoning_content` (DeepSeek R1 / Qwen QwQ), and `delta.reasoning` (some gateways). Claude path intentionally does not enable extended thinking (no `thinking` field in the request body).

3. **[src/git.ts](src/git.ts)** — two pure functions: `getGitDiff` shells out to `git diff --cached`, falling back to `git diff` when nothing is staged; `truncateDiff` splits on `diff --git` boundaries and keeps the first N lines per file (used by the Custom mode's smart-truncate option).

4. **[src/provider.ts](src/provider.ts)** — a small config object exposing `commandId` and a few localized message builders. Historical artifact from the upstream (Gemini CLI wrapper) that got thinned out when this fork switched to direct HTTP calls; do not add process-spawning logic here.

### Configuration model

All user-facing config lives under the `ai-commit-message.*` namespace in [package.json](package.json)'s `contributes.configuration`. Keys: `apiProvider`, `apiUrl`, `model`, `apiKey` (optional — primary storage is VS Code secrets), `promptZH`, `promptEN`, `showThinking`. The secret key ID is the literal string `ai-commit-message.apiKey` (defined in extension.ts, distinct from the settings key of the same name).

Default prompts hard-coded in `api.ts` (`PROMPT_ZH` / `PROMPT_EN`) are fallbacks only — the settings-level `promptZH` / `promptEN` override them. When editing prompt defaults, update **both** places or the two will drift.

### Locale

UI-language detection is `vscode.env.language` → `zh*` vs everything else (English). All user-visible strings go through the `M` dictionary in [extension.ts](src/extension.ts) or inline ternaries. No i18n framework — just `isChinese()` branches.

### Streaming contract

The streaming pipeline has one non-obvious invariant worth preserving: `readSSEStream` returns only the accumulated `text` chunks (after `cleanCodeBlock` strips ```` ``` ```` fences), never `thinking`. If you add a new chunk kind, decide explicitly whether it belongs in the commit message before appending to `fullText`.

## Identity / publishing

- `publisher` in [package.json](package.json) is `venberstep-vanilla` — changing it changes the extension's installed identifier (`<publisher>.<name>`), which is a breaking change for anyone who has the old VSIX installed.
- LICENSE carries three `Copyright` lines (original upstream author, venberstep, Vanilla_Yukirin) — keep additive when adding contributors; don't collapse into a joint copyright line.
