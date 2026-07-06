# Fluxus — Vision

## The problem: app-first fragmentation

App-first platforms treat the data model as a byproduct of building an app. Every app in a low-code builder conjures its own tables, its own connectors, its own API, its own private definition of *Customer* or *Asset* or *Work Order*. Ten apps later, the organisation owns ten partial, quietly diverging models of itself.

That is the fragmentation: the knowledge of what things **are** and how they **behave** is smeared across app-scoped schemas, SaaS silos, spreadsheets, and the heads of whoever built each app. An entire integration industry exists to reconcile data that should never have been separated in the first place. This is the biggest obstacle to digitising an organisation's data.

## The answer: model-first

Fluxus inverts the relationship. The **SDM** (Structured Data Model) defines the organisation's record types, relationships, workflows, and activities once, at the project level. Everything else — record UIs, page-builder apps, hooks, headless integrations — is a *projection over that one model*, scripted in one language.

Nothing can fragment because nothing ever leaves the model:

- A page doesn't have "a datasource" — it has a **query over the SDM**.
- A button doesn't call "an API" — it **runs an activity**.
- Every change, from any surface, lands in **one activity history**.

**Apps come and go; the model accumulates.**

## Why the DSL is the linchpin

The model unifies *what the data is*; the DSL unifies *how anyone talks to it*. A where-clause learned writing a show condition is the same where-clause in a hook, a page binding, and a headless workflow. Skills transfer between people and surfaces — the "only one person understands the invoicing app" problem structurally cannot form.

## The activity spine

Because even page-builder apps act through activities, data + behaviour + audit share one backbone. In app-first platforms, audit is per-app and usually an afterthought; in Fluxus, "who did what, from where, with what inputs" is a property of the architecture, not a feature. Reused third-party apps are automatically as governed as native ones — they can only *ask* via activities, never mutate directly.

## The trade-off, owned

Model-first demands modelling discipline up front — you can't skip straight to dragging a form onto a canvas. Fluxus's answer is the SDM plus a genuinely learnable DSL: the discipline costs an afternoon of SQL-level learning, not an enterprise-architecture engagement. That is the wedge.

## One-liner

> Every app builder gives you another place to put data. Fluxus gives every app the same place.
