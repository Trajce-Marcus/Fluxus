import { Modal } from './Modal';
import { RecordsGrid } from './RecordsGrid';
import type { RecordInstance } from '../types';

interface Props {
  targetTypeId: string;
  onSelect: (record: RecordInstance) => void;
  onClose: () => void;
}

export function RecordPickerDialog({ targetTypeId, onSelect, onClose }: Props) {
  return (
    <Modal title="Select Record" onClose={onClose}>
      <div style={{ minWidth: 480 }}>
        <RecordsGrid typeId={targetTypeId} onRecordSelected={onSelect} />
      </div>
    </Modal>
  );
}
