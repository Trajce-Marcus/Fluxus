// Users, admins and roles — the governance store (USERS.md).
//
// One population of people (`pool`), then grants laid on top, one module per
// tier: `org-admins` (who administers the organisation, plus its owner),
// `sol-admins` (who builds a solution), `op-admins` (who runs an operation),
// `op-users` (who may enter one) and `roles` (what they may do inside it).
//
// Split out of host.ts on 2026-08-04 with the model rewrite. host.ts is the
// activity/record plane; none of this touches the SDM, records or the engine —
// plain reads and writes against six small tables.

export * from './types';
export * from './pool';
export * from './org-admins';
export * from './sol-admins';
export * from './op-admins';
export * from './op-users';
export * from './roles';
export * from './bootstrap';
