#!/usr/bin/env node
// AI session costs — an interim measure until the Console's AI assistant keeps
// its own cost log (agreed 2026-10-13).
//
// Recounts every Claude Code session on this machine from ~/.claude/projects
// (sub-agent files included, so cold reviews and cold tests count), prices each
// at API list rates, and rewrites docs/ai-costs.csv. Rows for sessions whose
// files Claude Code has since deleted (it keeps them ~30 days) stay as logged.
//
// Run by the SessionEnd hook in .claude/settings.local.json; safe to run by hand:
//   node .claude/hooks/ai-costs.mjs
//
// Name a session with `/rename sol:<solution> <what>` for solution work, e.g.
// `/rename sol:inspections schedule step`. Any other name counts as platform.
//
// api_usd is what the session would cost through the API. plan_share is the
// session's slice of the monthly subscription: its api_usd over the calendar
// month's total, times PLAN_FEE (blank before FIRST_FULL_MONTH).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAN_FEE = 34;
// Months before this were already partly deleted when logging began, so their
// totals are incomplete and a share of the fee would be wrong — left blank.
const FIRST_FULL_MONTH = '2026-10';
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const LOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/ai-costs.csv');

// US$ per million tokens: input, output, cache read, cache write (5 min), cache write (1 h).
const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2, 5, 8],
  'claude-opus-5': [5, 25, 0.5, 6.25, 10],
  'claude-sonnet-5': [2, 10, 0.2, 2.5, 4],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25, 2],
  'claude-fable-5-1': [10, 50, 0.25, 12.5, 20],
};

const COLUMNS = ['session_id', 'project', 'started', 'last_active', 'name', 'tag', 'models', 'tokens', 'api_usd', 'agents_usd', 'plan_share'];

function cost(model, u) {
  const p = PRICES[model];
  if (!p) return null;
  const cc = u.cache_creation;
  const w5 = cc ? cc.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0;
  const w1 = cc ? cc.ephemeral_1h_input_tokens ?? 0 : 0;
  return ((u.input_tokens ?? 0) * p[0] + (u.output_tokens ?? 0) * p[1]
    + (u.cache_read_input_tokens ?? 0) * p[2] + w5 * p[3] + w1 * p[4]) / 1e6;
}

const localStamp = (d) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
};

// ── Count every session still on disk ─────────────────────────────────────────

function sessionFiles() {
  const out = [];
  for (const proj of fs.readdirSync(PROJECTS)) {
    const dir = path.join(PROJECTS, proj);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push({ proj, session: entry.name.slice(0, -6), file: path.join(dir, entry.name), sub: false });
      } else if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name, 'subagents');
        if (!fs.existsSync(subDir)) continue;
        for (const f of fs.readdirSync(subDir)) {
          if (f.endsWith('.jsonl')) out.push({ proj, session: entry.name, file: path.join(subDir, f), sub: true });
        }
      }
    }
  }
  return out;
}

function countSessions() {
  const sessions = new Map();
  const seen = new Set();
  for (const { proj, session, file, sub } of sessionFiles()) {
    let s = sessions.get(session);
    if (!s) {
      s = { session_id: session, project: proj.replace(/^-Users-[^-]+-dev-/, ''), first: null, last: null,
        aiTitle: '', customTitle: '', models: new Set(), unpriced: new Set(), tokens: 0, api: 0, agents: 0 };
      sessions.set(session, s);
    }
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      // Cheap filter before parsing: only these entry types matter.
      if (!line.includes('"usage"') && !line.includes('-title"')) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (!sub && d.type === 'ai-title') s.aiTitle = d.aiTitle ?? s.aiTitle;
      else if (!sub && d.type === 'custom-title') s.customTitle = d.customTitle ?? s.customTitle;
      else if (d.type === 'assistant') {
        const m = d.message ?? {};
        const u = m.usage;
        if (!u || !m.model || m.model.startsWith('<')) continue;
        const key = `${m.id}|${d.requestId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const when = new Date(d.timestamp);
        if (Number.isNaN(when.getTime())) continue;
        s.first = !s.first || when < s.first ? when : s.first;
        s.last = !s.last || when > s.last ? when : s.last;
        s.models.add(m.model);
        s.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
          + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        const c = cost(m.model, u);
        if (c === null) { s.unpriced.add(m.model); continue; }
        s.api += c;
        if (sub) s.agents += c;
      }
    }
  }
  const rows = new Map();
  for (const s of sessions.values()) {
    if (!s.first) continue;
    const name = s.customTitle || s.aiTitle;
    rows.set(s.session_id, {
      session_id: s.session_id,
      project: s.project,
      started: localStamp(s.first),
      last_active: localStamp(s.last),
      name,
      tag: /^sol:\S+/.test(name) ? name.match(/^sol:\S+/)[0] : 'platform',
      models: [...s.models].sort().map((m) => (s.unpriced.has(m) ? `${m} (unpriced)` : m)).join('; '),
      tokens: String(s.tokens),
      api_usd: s.api.toFixed(2),
      agents_usd: s.agents.toFixed(2),
    });
  }
  return rows;
}

// ── CSV in and out ────────────────────────────────────────────────────────────

function parseCsv(text) {
  const records = [];
  let field = '', record = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n') { record.push(field); records.push(record); field = ''; record = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  return records;
}

const csvField = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function readLog() {
  if (!fs.existsSync(LOG)) return new Map();
  const [header, ...records] = parseCsv(fs.readFileSync(LOG, 'utf8'));
  const rows = new Map();
  for (const r of records) {
    const row = Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']));
    if (row.session_id) rows.set(row.session_id, row);
  }
  return rows;
}

// ── Merge, share out the plan fee, write ──────────────────────────────────────

const logged = readLog();
const fresh = countSessions();
for (const [id, row] of fresh) {
  const old = logged.get(id);
  // Fewer tokens than logged means some of the session's files were cleaned up
  // since — keep the logged counts, take the current name.
  if (old && Number(old.tokens) > Number(row.tokens)) logged.set(id, { ...old, name: row.name, tag: row.tag });
  else logged.set(id, row);
}

const rows = [...logged.values()].sort((a, b) => a.started.localeCompare(b.started));
const monthTotal = {};
for (const r of rows) monthTotal[r.started.slice(0, 7)] = (monthTotal[r.started.slice(0, 7)] ?? 0) + Number(r.api_usd);
for (const r of rows) {
  const month = r.started.slice(0, 7);
  const total = monthTotal[month];
  r.plan_share = month < FIRST_FULL_MONTH ? '' : total > 0 ? (Number(r.api_usd) / total * PLAN_FEE).toFixed(2) : '0.00';
}

const out = [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvField(r[c] ?? '')).join(','))].join('\n') + '\n';
const tmp = `${LOG}.tmp`;
fs.writeFileSync(tmp, out);
fs.renameSync(tmp, LOG);
