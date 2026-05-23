import React from 'react';
import { ChevronUp, ChevronDown, CircleDot, Flag, GitBranch, Goal, GripVertical, MapPin } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const kindLabel = { start: 'Start Line', gate: 'Gate', finish: 'Finish Line', buoy: 'Buoy Mark' };

const checkpointIcons = {
  start: Flag,
  buoy: CircleDot,
  gate: GitBranch,
  finish: Goal,
};

function SortableRow({ checkpoint, isSelected, onSelect }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: checkpoint.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 50 : 'auto',
  };

  const Icon = checkpointIcons[checkpoint.kind] || MapPin;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`checkpoint-item${isSelected ? ' selected' : ''}`}
    >
      {/* Drag handle — only for non-singleton items */}
      {checkpoint.kind !== 'start' && checkpoint.kind !== 'finish' ? (
        <div
          {...attributes}
          {...listeners}
          style={{ padding: '0 4px 0 0', cursor: 'grab', touchAction: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          <GripVertical size={16} color="#94a3b8" />
        </div>
      ) : (
        <div style={{ width: '20px', flexShrink: 0 }} />
      )}

      <button
        type="button"
        className="checkpoint-select"
        onClick={() => onSelect(checkpoint.id)}
      >
        <div className={`checkpoint-marker ${checkpoint.kind}`}>
          <Icon size={16} />
        </div>
        <div className="checkpoint-summary">
          <strong>{checkpoint.id}</strong>
          <span>{kindLabel[checkpoint.kind]}</span>
        </div>
      </button>
    </li>
  );
}

export default function CourseBottomSheet({
  checkpoints,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  onReorder,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorder(active.id, over.id);
    }
  };

  return (
    <div className={`rc-bottom-sheet${expanded ? '' : ' collapsed'}`}>
      {/* Pill handle */}
      <div className="rc-bottom-sheet-handle" />

      {/* Header row — tap to toggle */}
      <div
        className="rc-bottom-sheet-handle-row"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        aria-expanded={expanded}
        aria-label="Toggle course sequence"
      >
        <span className="rc-bottom-sheet-title">Course Sequence</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="rc-bottom-sheet-count">{checkpoints.length}</span>
          {expanded ? <ChevronDown size={16} color="#64748b" /> : <ChevronUp size={16} color="#64748b" />}
        </div>
      </div>

      {/* Body — only rendered when expanded so animations are smooth */}
      {expanded && (
        <div className="rc-bottom-sheet-body">
          {checkpoints.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem', padding: '16px 0' }}>
              No course elements yet. Tap + to add.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={checkpoints.map((cp) => cp.id)} strategy={verticalListSortingStrategy}>
                <ul className="checkpoint-list" style={{ paddingBottom: 4 }}>
                  {checkpoints.map((cp) => (
                    <SortableRow
                      key={cp.id}
                      checkpoint={cp}
                      isSelected={cp.id === selectedId}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
    </div>
  );
}
