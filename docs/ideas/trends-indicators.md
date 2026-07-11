# Idea: Trends / Indicators — AI insights on the model's own pulse

**Status:** idea only — captured 2026-07-08, not scheduled, not designed. Nothing in ROADMAP depends on this; conversely this depends on several things that exist (activity stream, DSL validator) and several that don't yet (reporting layer in production, scheduler, org hierarchy).

**Naming:** working title "Trends". Likely better: **Indicators** or **Signals** — the trend is the visualisation; the defined, measured thing is the indicator. Glossary decision deferred until taken up.

## The idea

A platform module that lets any attribute, activity, or record population be **tracked over time** — stock-ticker style — and layers AI on top to find correlations, explain movements, and eventually propose what to monitor and what to change.

- An **indicator definition** names what is measured and holds the measure expression (a FluxScript query). Examples: *defects of type X opened per day, last 30 days*; *repair cost for defect type X per day*.
- Measurements are **logged as a time series as they happen**, not recomputed by looking back on every view — cheap to query, accurate at capture.
- Indicators can be **published** for others in the org to view.
- **Events/annotations** attach to an indicator's timeline: internal interventions ("7 Jul 2026 — increased routine maintenance on asset type xyz") and external context ("fuel price spike"). Looking at a trend, you see *why* it moved.
- **External series** can be ingested alongside internal ones (e.g. diesel cost, Melbourne) so internal and external movements can be compared.
- **AI layer:** with the SDM inspectable, an AI can understand what the series *mean*, find correlations between them, propose new indicators driven by a stated goal (budget → cost indicators; SLA → service indicators), suggest interventions, and monitor intervention efficacy via the annotation mechanism.

In one line: **an AI insights tool for an org's data and performance metrics, as the org defines them.**

## Why it fits this platform specifically

These are the load-bearing arguments; they're also the pitch.

1. **The activity stream is a complete, semantic change feed.** "No write path bypasses activities" means an indicator engine subscribed to the committed activity stream can never miss a measurement input. It is simply a **third consumer of the existing outbox** (alongside `queue` dispatch and reporting projection). No CDC, no dual writes, no new capture machinery.
2. **The SDM is a free semantic layer.** Generic AI-on-BI tools fail because warehouse schemas are semantically opaque. Here the model is self-describing: named record types, attributes, workflows encoding process, history encoding who/what/when/via-which-activity. The AI reads semantics rather than reverse-engineering them.
3. **Indicator definitions are FluxScript.** One-language thesis holds. Critically, the **config-save-time validator becomes the AI's guardrail**: an AI-authored indicator definition is validated against the SDM exactly like a human-authored one — declarative, validated, inspectable output, not arbitrary code.
4. **It accumulates on the model.** Apps come and go; indicators, like the audit spine, get more valuable the longer the model lives. Strengthens the model-first thesis.

## Design notes settled during discussion

- **"Forward-logged" refined to: append-forward by default, backfillable by re-projection.** Two measure classes:
  - *Stream-derived* (counts, sums, durations from activities) — incremental **and** backfillable via activity-stream replay (same machinery as reporting rebuilds). Kills the cold-start problem: define an indicator today, see history immediately.
  - *Sampled* (point-in-time state, external feeds) — logged forward only, cannot be reconstructed. Requires a scheduler — **the platform's first non-request-driven compute**, a genuinely new runtime concern.
- **Internal annotations can be automatic.** Interventions in this platform *are activities*, and SDM config changes are observable events — so indicators can self-annotate with pertinent internal changes. Manual entry is only for external context. Auto-annotated interventions + time series is exactly the input shape for intervention analysis ("did the change on date X shift the trend"), so the efficacy-monitoring loop comes almost free.
- **Storage:** time series belong in the **reporting layer** (lag acceptable by its contract; Postgres fine at v1).
- **Scope-blindness holds:** indicator definitions never name their org/SDM, like all FluxScript. Publishing/sharing touches the org hierarchy, which is future work — fine as long as definitions stay scope-blind.
- **AI caution:** correlation-mining over many series finds spurious relationships enthusiastically. Mitigation is structural: the SDM gives the AI causal priors (FK relationships, shared workflows) to prefer plausible pairs. Frame the AI as proposing *hypotheses with model-grounded rationale*, human-confirmed — not declaring insights.

## Prior art / positioning

The pieces exist separately — metric layers (dbt/MetricFlow, Cube), metric root-cause tools (Sisu, Falkon), KPI anomaly detection — but all bolt onto warehouses plus hand-built semantic layers. The differentiated claim: **the audit spine is complete by construction and the model is self-describing, therefore metrics and AI insight come nearly free.**

## Open questions (unresolved, revisit when taken up)

1. **Dog-fooding:** is a measurement a first-class platform concept, or "just" a special record type whose measurements arrive via activities? (If the latter, indicators inherit history, hooks, and the workbench for free.)
2. **Scheduler ownership** for sampled measures — where does recurring compute live in the hosting picture (Lambda cron? something else)?
3. **AI write permissions:** propose indicator definitions for human approval only, or create-and-monitor autonomously within a budget/goal envelope?
4. Package boundary: new `@fluxus/indicators` package vs. a `services`-root module plus page-builder display components.
