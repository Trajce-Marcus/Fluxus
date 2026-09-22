import { Modal } from './Modal';
import { RecordsGrid } from './RecordsGrid';
import type { RecordPickerProps } from '@fluxus/page-runtime';

/**
 * Picking a record by browsing the whole snapshot — the workbench's own way in,
 * and the only one it has: this needs the records the browser holds here and a
 * page does not.
 *
 * **It supplies the label now** (RECORD_PICKER §6). The form used to resolve it
 * afterwards, off the snapshot, which returns the raw id wherever there is no
 * snapshot. The display field comes in as a prop and the readable value goes
 * back with the choice; the answer is the same one `resolveDisplayLabel` gave —
 * the record's own field, or the id when it holds nothing.
 */
export function RecordPickerDialog({ targetTypeId, displayField, onSelect, onClose }: RecordPickerProps) {
  return (
    <Modal title="Select Record" onClose={onClose}>
      <div style={{ minWidth: 480 }}>
        <RecordsGrid
          typeId={targetTypeId}
          onRecordSelected={(record) => {
            const label = displayField ? record.customFields[displayField] : undefined;
            onSelect(record.id, String(label ?? record.id));
          }}
        />
      </div>
    </Modal>
  );
}
