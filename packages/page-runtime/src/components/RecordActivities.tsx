// What can be done to this record, according to the model.
//
// The page-side answer to a row of hand-placed `RunActivity` buttons: those are
// the author listing acts by hand, which goes stale the moment the workflow
// changes and shows a button the model would refuse. This asks the record type's
// workflow instead, and each activity's own `show_condition` decides whether it
// is offered — so a frozen WBS simply stops offering the acts it refuses, and
// nobody has to keep a page in step with a model.
//
// It is the workbench's `AvailableActivities` as a page component. The
// difference is where the list comes from: the workbench holds the whole
// operation's records and evaluates locally, while a page asks its host
// (`services.listActivities`), which fetches the record and evaluates with the
// same expression host everything else on the page uses.
//
// This does not reopen the 2026-08-26 ruling that a control shows whether or
// not it is wired. That ruling is about **wiring** — the author's omission,
// which must be loud. This is **availability** — the model's answer to *may I
// do this?* — and hiding is exactly what that answer looks like.

import { useEffect, useState } from 'react';
import type { PropSchema } from '../manifest';
import type { PageServiceHandlers } from '../pageHost';
import type { ActivityOption } from '../availableActivities';
import { actionCss } from './actionComponents';

interface Props {
  /** Heading above the buttons. Blank draws none. */
  title?: string;
  /** The record the acts are about — a page binds its own. */
  record?: string | null;
  /** Shown when the model offers nothing. Blank draws nothing at all. */
  emptyMessage?: string;
  /** Supplied by the host, not by the author (see ComponentContainer). */
  services?: PageServiceHandlers;
}

const css = `
  ${actionCss}
  /* The label sits beside the buttons, not above them: a row of acts is one
     line, and a heading on its own line costs a line for one word. */
  .ra-root { font-family: system-ui, sans-serif; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .ra-title { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #64748b; white-space: nowrap; }
  .ra-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .ra-btn { padding: 5px 14px; font-size: 0.78rem; }
  .ra-empty { font-size: 0.75rem; color: #94a3b8; font-style: italic; }
`;

function RecordActivitiesComponent({ title, record, emptyMessage, services }: Props) {
  const [activities, setActivities] = useState<ActivityOption[]>([]);
  const [asked, setAsked] = useState(false);

  // Re-asked whenever the record changes — and after a run, because
  // ComponentContainer re-evaluates a component's props once an activity
  // completes, which is what makes "Approve WBS" disappear the moment the WBS
  // is approved.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = services ? await services.listActivities(record ?? null) : [];
      if (!cancelled) { setActivities(found); setAsked(true); }
    })();
    return () => { cancelled = true; };
  }, [services, record]);

  const id = record === null || record === undefined || record === '' ? null : String(record);

  return (
    <div className="ra-root">
      {title ? <div className="ra-title">{title}</div> : null}
      {activities.length > 0 ? (
        <div className="ra-row">
          {activities.map((activity) => (
            <button
              key={activity.id}
              className="fx-action-btn ra-btn"
              title={activity.id}
              onClick={() => services?.runActivity(activity.id, id)}
            >
              {activity.name}
            </button>
          ))}
        </div>
      ) : asked && emptyMessage ? (
        <div className="ra-empty">{emptyMessage}</div>
      ) : null}
    </div>
  );
}

const schema: PropSchema[] = [
  { name: 'title',        kind: 'static-config', type: 'string', required: false, description: 'Heading above the buttons — blank for none' },
  { name: 'record',       kind: 'dynamic-data',  type: 'string', required: false, description: 'The record the acts are about — usually context.record.id' },
  { name: 'emptyMessage', kind: 'static-config', type: 'string', required: false, description: 'Shown when the model offers nothing right now' },
];

export const RecordActivities = Object.assign(RecordActivitiesComponent, { css, schema });
