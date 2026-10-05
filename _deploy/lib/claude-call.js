'use strict';

// One transport for every blog machine's Claude call.
//
// With CLAUDE_CODE_OAUTH_TOKEN set (minted once with `claude setup-token`), the
// call runs through the Claude Agent SDK on the Claude Max subscription, so it
// spends no API credit. Without it -- or when the subscription can't serve the
// call (token expired, plan usage limit hit, SDK not installed) -- it falls back
// to the pay-as-you-go API on ANTHROPIC_API_KEY, exactly as before. With neither
// usable -- or when the API itself refuses the key -- the error carries
// `isBlock = true`: no retry this run can clear it.
//
// Standalone copy of netwebmedia/_deploy/lib/claude-call.js, minus that repo's
// anthropic-block module.
//
// Both paths return the Messages API response shape -- { content: [{ type, text }],
// stop_reason } -- so callers parse it the same way whichever path served it.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const API_URL = 'https://api.anthropic.com/v1/messages';

// Agent SDK errors no retry clears within a run: auth or account trouble, or the
// plan's usage limit, which resets hours later rather than seconds.
const SUBSCRIPTION_BLOCKS = new Set([
  'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold',
  'verification_required', 'billing_error', 'rate_limit',
]);

// Spawning the bundled claude binary costs a few seconds before the first token.
const CLI_STARTUP_MS = 20000;

// Once the subscription refuses, later calls in the run go straight to the API
// instead of paying the spawn-and-fail cost (and a warning) every time.
let subscriptionDown = null;

function claudeConfigured() {
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
}

async function callClaude({ apiKey = process.env.ANTHROPIC_API_KEY, model, system, user, maxTokens, timeoutMs }) {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN && !subscriptionDown) {
    try {
      return await viaSubscription({ model, system, user, maxTokens, timeoutMs });
    } catch (e) {
      if (!e.subscriptionUnavailable) throw e;
      subscriptionDown = e.message;
      if (!apiKey) throw blocked(`Claude subscription unavailable (${e.message}) and ANTHROPIC_API_KEY is not set. Fix: ${e.fix}`);
      console.log(`::warning::Claude subscription unavailable (${e.message}) -- falling back to ANTHROPIC_API_KEY for the rest of this run.`);
    }
  }
  if (!apiKey) throw new Error('Neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set');
  return viaApi({ apiKey, model, system, user, maxTokens, timeoutMs });
}

// CI installs the SDK outside the repo so the site's package.json stays
// untouched; CLAUDE_AGENT_SDK_DIR points at that install prefix.
async function loadAgentSdk() {
  const dir = process.env.CLAUDE_AGENT_SDK_DIR;
  if (!dir) return import('@anthropic-ai/claude-agent-sdk');
  const pkgDir = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
  const { main = 'sdk.mjs' } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  return import(pathToFileURL(path.join(pkgDir, main)).href);
}

function blocked(message) {
  const err = new Error(message);
  err.isBlock = true;
  return err;
}

function unavailable(reason, fix) {
  const err = new Error(reason);
  err.subscriptionUnavailable = true;
  err.fix = fix;
  return err;
}

async function viaSubscription({ model, system, user, maxTokens, timeoutMs }) {
  let sdk;
  try {
    sdk = await loadAgentSdk();
  } catch (e) {
    throw unavailable(`Agent SDK not installed: ${e.message}`,
      "Install @anthropic-ai/claude-agent-sdk (the workflow's 'Install Claude Agent SDK' step)");
  }

  const env = { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxTokens) };
  // With an API key in its env, Claude Code bills the API instead of the plan.
  delete env.ANTHROPIC_API_KEY;

  const limitMs = timeoutMs + CLI_STARTUP_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), limitMs);
  let result = null;
  let error = null;
  let text = '';
  try {
    for await (const msg of sdk.query({
      prompt: user,
      options: {
        model,
        systemPrompt: system,
        tools: [],                      // plain completion: no file, shell or web tools
        maxTurns: 1,
        settingSources: [],             // ignore any CLAUDE.md or settings on the runner
        thinking: { type: 'disabled' }, // match the API calls this replaced
        env,
        abortController: ac,
      },
    })) {
      if (msg.type === 'assistant') {
        if (msg.error) error = msg.error;
        else for (const b of msg.message.content || []) if (b.type === 'text') text += b.text;
      } else if (msg.type === 'result') {
        result = msg;
      }
    }
  } catch (e) {
    if (ac.signal.aborted) throw new Error(`API request timed out after ${limitMs / 1000}s`);
    // The SDK can throw after yielding an error result; classify that below.
    if (!result) throw e;
  } finally {
    clearTimeout(timer);
  }

  const detail = result && (result.result || (result.errors || []).join('; ') || result.subtype);
  if (error && SUBSCRIPTION_BLOCKS.has(error)) {
    throw unavailable(`${error}: ${detail || ''}`.trim(), error === 'rate_limit'
      ? 'Wait for the Claude plan usage limit to reset'
      : 'Re-mint the token with `claude setup-token` and update the CLAUDE_CODE_OAUTH_TOKEN secret');
  }
  // Claude Code continues a reply that hits the output cap with follow-up requests,
  // so the whole reply is every text block joined -- result.result holds only the
  // last piece. If it still ran out, callers salvage what fit, as they do for an
  // API response cut at max_tokens.
  if (error === 'max_output_tokens') return { content: [{ type: 'text', text }], stop_reason: 'max_tokens' };
  if (!result || result.is_error) throw new Error(`Claude subscription call failed: ${detail || error || 'no result'}`);
  return { content: [{ type: 'text', text: text || result.result }], stop_reason: result.stop_reason || 'end_turn' };
}

async function viaApi({ apiKey, model, system, user, maxTokens, timeoutMs }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  let body;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: ac.signal,
    });
    body = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`API request timed out after ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }

  // Out of credits / bad key: no retry can clear it, so unwind the caller's loop.
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /credit balance is too low/i.test(body))) {
    throw blocked(`API blocked (${res.status}): ${body.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`API error ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

module.exports = { callClaude, claudeConfigured };
