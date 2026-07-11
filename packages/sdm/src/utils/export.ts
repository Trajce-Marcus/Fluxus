import type { RecordInstance, CustomFieldDef } from '@fluxus/engine';

function csvCell(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n')
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToCSV(
  records: RecordInstance[],
  fields: CustomFieldDef[],
  filename: string
): void {
  const keys = fields.map(f => f.key);
  const header = keys.map(csvCell).join(',');
  const rows = records.map(r =>
    keys.map(k => csvCell(String(r.customFields[k] ?? ''))).join(',')
  );
  triggerDownload([header, ...rows].join('\n'), `${filename}.csv`, 'text/csv');
}

export function exportToJSON(
  records: RecordInstance[],
  fields: CustomFieldDef[],
  filename: string
): void {
  const keys = fields.map(f => f.key);
  const data = records.map(r =>
    Object.fromEntries(keys.map(k => [k, r.customFields[k] ?? '']))
  );
  triggerDownload(JSON.stringify(data, null, 2), `${filename}.json`, 'application/json');
}
