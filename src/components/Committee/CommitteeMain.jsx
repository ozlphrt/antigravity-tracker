import React, { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { CircleDot, Flag, Goal, GitBranch, MapPin, MousePointer2, RotateCcw, Trash2, Menu, Crosshair, Save, FolderOpen, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  TouchSensor
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../../database/mockSupabase';
import RaceLineMarker from '../RaceLineMarker';
import { lineCrossingLabel, normalizeLineCrossing } from '../../utils/raceLine';
import PendingLinePreview from './PendingLinePreview';

const withLineCheckpoint = (checkpoint, kind, id) => ({
  ...checkpoint,
  id,
  kind,
  type: 'gate',
  crossing: normalizeLineCrossing(checkpoint.crossing),
});

const createRoundingBuoyIcon = (rounding, id = '') => {
  const isPort = rounding === 'port';
  const svgPath = isPort
    ? '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'
    : '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>';
  const animClass = isPort ? 'buoy-spin-ccw' : 'buoy-spin-cw';

  return new L.DivIcon({
    html: `<div class="course-buoy-icon">
      <svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#F26419" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="${animClass}">
        ${svgPath}
      </svg>
      <div style="position: absolute; color: #1e293b; font-weight: 900; font-size: 16px; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">${id}</div>
    </div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

const tempPointIcon = new L.DivIcon({
  html: '<div class="temp-point-marker"></div>',
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const lineEndpointHitIcon = (isActive) => new L.DivIcon({
  html: `<div class="line-endpoint-hit${isActive ? ' is-active' : ''}"></div>`,
  className: 'line-endpoint-hit-shell',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const tools = [
  { id: 'gate', label: 'Add Line', icon: GitBranch },
  { id: 'buoy', label: 'Add Buoy', icon: CircleDot },
];

const lineLabels = {
  start: 'Start Line',
  gate: 'Gate',
  finish: 'Finish Line',
};

const checkpointIcons = {
  start: Flag,
  buoy: CircleDot,
  gate: GitBranch,
  finish: Goal,
};

const createId = (type, checkpoints) => {
  if (type === 'start') return 'S';
  if (type === 'finish') return 'F';

  const existingIds = new Set(checkpoints.map(cp => cp.id));
  let count = 1;
  let nextId = type === 'gate' ? `G${count}` : `${count}`;

  while (existingIds.has(nextId)) {
    count += 1;
    nextId = type === 'gate' ? `G${count}` : `${count}`;
  }

  return nextId;
};

const formatCoord = (value) => {
  if (Number.isNaN(Number(value))) return '';
  return Number(value).toFixed(6);
};

const parseCoord = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeCourseObjects = (checkpoints) => {
  let buoyCount = 0;
  let gateCount = 0;

  const normalized = checkpoints.map((checkpoint) => {
    const kind = checkpoint.kind
      || (checkpoint.id === 'start' || checkpoint.id === 'S' ? 'start' : null)
      || (checkpoint.id === 'finish' || checkpoint.id === 'F' ? 'finish' : null)
      || checkpoint.type;

    if (kind === 'buoy') {
      buoyCount += 1;
      return { ...checkpoint, id: `${buoyCount}`, kind };
    }

    if (kind === 'gate') {
      if (checkpoint.id === 'start' || checkpoint.id === 'finish') {
        const lineKind = checkpoint.id === 'start' ? 'start' : 'finish';
        return withLineCheckpoint(checkpoint, lineKind, lineKind === 'start' ? 'S' : 'F');
      }
      gateCount += 1;
      return withLineCheckpoint(checkpoint, 'gate', `G${gateCount}`);
    }

    if (kind === 'start' || kind === 'finish') {
      return withLineCheckpoint(
        checkpoint,
        kind,
        kind === 'start' ? 'S' : 'F',
      );
    }

    return {
      ...checkpoint,
      id: kind === 'start' ? 'S' : kind === 'finish' ? 'F' : checkpoint.id,
      kind,
    };
  });

  const lastStartIndex = normalized.findLastIndex(checkpoint => checkpoint.kind === 'start');
  const lastFinishIndex = normalized.findLastIndex(checkpoint => checkpoint.kind === 'finish');

  return normalized.filter((checkpoint, index) => {
    if (checkpoint.kind === 'start') return index === lastStartIndex;
    if (checkpoint.kind === 'finish') return index === lastFinishIndex;
    return true;
  });
};

function CourseClickHandler({ activeTool, onPlacePoint }) {
  useMapEvents({
    click: (event) => {
      onPlacePoint([event.latlng.lat, event.latlng.lng]);
    },
  });

  return null;
}

function SortableCheckpointItem({ checkpoint, selectedCheckpoint, selectCheckpoint, removeCheckpoint, onEditCoordinates, updateRounding, updateLineCrossing }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: checkpoint.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 'auto',
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className={`checkpoint-item ${selectedCheckpoint?.id === checkpoint.id ? 'selected' : ''}`}>
      {checkpoint.kind !== 'start' && checkpoint.kind !== 'finish' ? (
        <div className="drag-handle" {...attributes} {...listeners} style={{ padding: '0 8px 0 0', cursor: 'grab', touchAction: 'none', display: 'flex', alignItems: 'center' }}>
          <Menu size={32} color="#64748b" />
        </div>
      ) : (
        <div style={{ padding: '0 8px 0 0', width: '32px', boxSizing: 'content-box', display: 'flex', alignItems: 'center' }}></div>
      )}

      <button
        type="button"
        className="checkpoint-select"
        onClick={() => selectCheckpoint(checkpoint.id, null)}
      >
      <div className={`checkpoint-marker ${checkpoint.kind}`}>
        {React.createElement(checkpointIcons[checkpoint.kind] || MapPin, { size: 24 })}
      </div>

      <div className="checkpoint-summary">
        <strong>{checkpoint.id}</strong>
        <span>{checkpoint.kind === 'buoy' ? 'Buoy mark' : lineLabels[checkpoint.kind]}</span>
      </div>
      </button>

      {checkpoint.kind === 'buoy' && (
        <button 
          className={`rounding-pill ${checkpoint.rounding}`}
          style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.75rem' }}
          onClick={(e) => {
            e.stopPropagation();
            updateRounding(checkpoint.id, checkpoint.rounding === 'port' ? 'starboard' : 'port');
          }}
        >
          {checkpoint.rounding === 'port' ? 'Port' : 'Stbd'}
        </button>
      )}

      {(checkpoint.kind === 'start' || checkpoint.kind === 'gate' || checkpoint.kind === 'finish') && (
        <button 
          className={`rounding-pill ${normalizeLineCrossing(checkpoint.crossing)}`}
          style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.75rem' }}
          onClick={(e) => {
            e.stopPropagation();
            updateLineCrossing(checkpoint.id, normalizeLineCrossing(checkpoint.crossing) === 'up' ? 'down' : 'up');
          }}
        >
          {lineCrossingLabel(checkpoint.crossing)}
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center' }}>
        {selectedCheckpoint?.id === checkpoint.id && (
          <button
            type="button"
            className="icon-action"
            title={`Edit Coordinates for ${checkpoint.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onEditCoordinates();
            }}
          >
            <Crosshair size={24} />
          </button>
        )}
        <button
          type="button"
          className="icon-action"
          title={`Remove ${checkpoint.id}`}
          onClick={() => removeCheckpoint(checkpoint.id)}
        >
          <Trash2 size={24} />
        </button>
      </div>
    </li>
  );
}

function LineEndpointMarker({ position, isActive, label, onSelect, onMove }) {
  return (
    <Marker
      position={position}
      icon={lineEndpointHitIcon(isActive)}
      draggable={isActive}
      autoPan={isActive}
      title={label}
      eventHandlers={{
        click: (event) => {
          L.DomEvent.stopPropagation(event.originalEvent);
          onSelect();
        },
        dragend: (event) => {
          if (!isActive) return;
          const { lat, lng } = event.target.getLatLng();
          onMove([lat, lng]);
        },
      }}
    />
  );
}

function SelectedObjectFocus({ selectedCheckpointId, selectedLineEndpointIndex, getCheckpoint }) {
  const map = useMapEvents({});

  useEffect(() => {
    if (!selectedCheckpointId) return;
    const selectedCheckpoint = getCheckpoint(selectedCheckpointId);
    if (!selectedCheckpoint) return;

    if (selectedCheckpoint.type === 'buoy') {
      map.panTo(selectedCheckpoint.coord, { duration: 0.8 });
      return;
    }

    if (selectedLineEndpointIndex !== null) {
      map.panTo(selectedCheckpoint.coords[selectedLineEndpointIndex], { duration: 0.8 });
      return;
    }

    const bounds = L.latLngBounds(selectedCheckpoint.coords);
    map.panTo(bounds.getCenter(), { duration: 0.8 });
    
    // Explicitly omit getCheckpoint from dependencies so it ONLY pans when selection changes, 
    // NOT when coords update during a drag event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedCheckpointId, selectedLineEndpointIndex]);

  return null;
}

const enforceCourseOrder = (checkpoints) => {
  const start = checkpoints.filter(cp => cp.kind === 'start');
  const middle = checkpoints.filter(cp => cp.kind !== 'start' && cp.kind !== 'finish');
  const finish = checkpoints.filter(cp => cp.kind === 'finish');
  return [...start, ...middle, ...finish];
};

export default function CommitteeMain({ courseDraft, onCourseChange }) {
  const [course, setCourse] = useState(null);
  const [draftCheckpoints, setDraftCheckpoints] = useState([]);
  const [activeTool, setActiveTool] = useState('gate');
  const [pendingLinePoint, setPendingLinePoint] = useState(null);
  const [pendingLineCrossing, setPendingLineCrossing] = useState('up');
  const [selectedCheckpointId, setSelectedCheckpointId] = useState(null);
  const [selectedLineEndpointIndex, setSelectedLineEndpointIndex] = useState(null);
  const [isCoordinateModalOpen, setIsCoordinateModalOpen] = useState(false);
  const [isOpenModalVisible, setIsOpenModalVisible] = useState(false);
  const [isSaveModalVisible, setIsSaveModalVisible] = useState(false);
  const [savedCourses, setSavedCourses] = useState([]);
  const [newCourseName, setNewCourseName] = useState('');

  const handleOpenCoursesList = () => {
    supabase.getCourses().then(courses => {
      setSavedCourses(courses);
      setIsOpenModalVisible(true);
    });
  };

  const handleSaveCourseClick = () => {
    setIsSaveModalVisible(true);
  };

  const handleConfirmSave = (isNew) => {
    const finalName = isNew ? (newCourseName.trim() || 'New Course') : course.name;
    const finalId = isNew ? `course-${Date.now()}` : course.id;
    
    const courseToSave = {
      ...course,
      id: finalId,
      name: finalName,
      checkpoints: orderedCheckpoints,
    };
    
    supabase.saveCourse(courseToSave).then(() => {
      setCourse(courseToSave);
      onCourseChange(courseToSave);
      setIsSaveModalVisible(false);
      setNewCourseName('');
    });
  };

  const handleDeleteCourse = (id) => {
    supabase.deleteCourse(id).then(() => {
      setSavedCourses(prev => prev.filter(c => c.id !== id));
    });
  };

  const selectCheckpoint = (id, endpointIndex = null) => {
    setSelectedCheckpointId(id);
    setSelectedLineEndpointIndex(endpointIndex);
    const checkpoint = draftCheckpoints.find(cp => cp.id === id);
    if (checkpoint && checkpoint.kind !== 'buoy') {
      setPendingLineCrossing(normalizeLineCrossing(checkpoint.crossing));
    }
  };

  useEffect(() => {
    if (courseDraft) {
      setCourse(courseDraft);
      const checkpoints = enforceCourseOrder(normalizeCourseObjects(courseDraft.checkpoints));
      setDraftCheckpoints(checkpoints);
      return;
    }

    supabase.getCourses().then(courses => {
      const firstCourse = courses[0];
      setCourse(firstCourse);
      const checkpoints = enforceCourseOrder(normalizeCourseObjects(firstCourse.checkpoints));
      setDraftCheckpoints(checkpoints);
    });
  }, [courseDraft]);

  const instruction = useMemo(() => {
    if (activeTool === 'buoy') return 'Tap map to place a Buoy.';
    if (!pendingLinePoint) return 'Tap map to place Point A (Left).';
    return 'Tap map again to place Point B (Right).';
  }, [activeTool, pendingLinePoint]);

  const resetPendingToolState = (tool) => {
    setActiveTool(tool);
    setPendingLinePoint(null);
    setSelectedCheckpointId(null);
    setSelectedLineEndpointIndex(null);
  };

  const handleMapPoint = (point) => {
    if (activeTool === 'buoy') {
      let nextId = null;
      setDraftCheckpoints((prev) => {
        nextId = createId('buoy', prev);
        return enforceCourseOrder([...prev, {
          id: nextId,
          kind: 'buoy',
          type: 'buoy',
          coord: point,
          rounding: 'port',
        }]);
      });
      if (nextId) selectCheckpoint(nextId, null);
      return;
    }

    const kind = activeTool;
    
    if (!pendingLinePoint) {
      setPendingLinePoint(point);
      return;
    }

    let nextId = null;
    setDraftCheckpoints((prev) => {
      nextId = createId(kind, prev);
      const nextCheckpoint = {
        id: nextId,
        kind,
        type: 'gate',
        coords: [pendingLinePoint, point],
        crossing: pendingLineCrossing,
      };

      if (kind === 'start' || kind === 'finish') {
        return enforceCourseOrder(normalizeCourseObjects([...prev.filter(cp => cp.kind !== kind), nextCheckpoint]));
      }

      return enforceCourseOrder([...prev, nextCheckpoint]);
    });
    setPendingLinePoint(null);
    if (nextId) selectCheckpoint(nextId, null);
  };

  const updateRounding = (id, rounding) => {
    setDraftCheckpoints(prev => prev.map(cp => (
      cp.id === id ? { ...cp, rounding } : cp
    )));
  };

  const updateLineKind = (id, kind) => {
    setDraftCheckpoints(prev => enforceCourseOrder(prev.map(cp => (
      cp.id === id ? { ...cp, kind } : cp
    ))));
  };

  const updateLineCrossing = (id, crossing) => {
    setDraftCheckpoints(prev => prev.map(cp => (
      cp.id === id ? { ...cp, crossing: normalizeLineCrossing(crossing) } : cp
    )));
  };

  const updateBuoyCoord = (id, coordIndex, value) => {
    setDraftCheckpoints(prev => prev.map(cp => {
      if (cp.id !== id) return cp;
      const coord = [...cp.coord];
      coord[coordIndex] = parseCoord(value, coord[coordIndex]);
      return { ...cp, coord };
    }));
  };

  const updateBuoyPosition = (id, point) => {
    setDraftCheckpoints(prev => prev.map(cp => (
      cp.id === id ? { ...cp, coord: point } : cp
    )));
  };

  const updateLineCoord = (id, pointIndex, coordIndex, value) => {
    setDraftCheckpoints(prev => prev.map(cp => {
      if (cp.id !== id) return cp;
      const coords = cp.coords.map(point => [...point]);
      coords[pointIndex][coordIndex] = parseCoord(value, coords[pointIndex][coordIndex]);
      return { ...cp, coords };
    }));
  };

  const updateLinePoint = (id, pointIndex, point) => {
    setDraftCheckpoints(prev => prev.map(cp => {
      if (cp.id !== id) return cp;
      const coords = cp.coords.map(coord => [...coord]);
      coords[pointIndex] = point;
      return { ...cp, coords };
    }));
  };

  const removeCheckpoint = (id) => {
    setDraftCheckpoints(prev => prev.filter(cp => cp.id !== id));
    if (selectedCheckpointId === id) {
      setSelectedCheckpointId(null);
      setSelectedLineEndpointIndex(null);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setDraftCheckpoints((items) => {
        const oldIndex = items.findIndex(cp => cp.id === active.id);
        const newIndex = items.findIndex(cp => cp.id === over.id);
        return enforceCourseOrder(arrayMove(items, oldIndex, newIndex));
      });
    }
  };

  const orderedCheckpoints = draftCheckpoints;

  const selectedCheckpoint = orderedCheckpoints.find(cp => cp.id === selectedCheckpointId) || orderedCheckpoints[0] || null;
  const singletonKinds = new Set(draftCheckpoints
    .filter(checkpoint => checkpoint.kind === 'start' || checkpoint.kind === 'finish')
    .map(checkpoint => checkpoint.kind));

  // Auto-sync draft to App.jsx designedCourse when checkpoints change
  useEffect(() => {
    if (!course) return;

    const currentState = JSON.stringify(course?.checkpoints?.map(c => ({ id: c.id, kind: c.kind, coords: c.coords, coord: c.coord, crossing: c.crossing, rounding: c.rounding })));
    const orderedState = JSON.stringify(orderedCheckpoints.map(c => ({ id: c.id, kind: c.kind, coords: c.coords, coord: c.coord, crossing: c.crossing, rounding: c.rounding })));
    
    if (currentState === orderedState) return;

    onCourseChange({
      ...course,
      checkpoints: orderedCheckpoints,
    });
  }, [course, orderedCheckpoints, onCourseChange]);

  return (
    <>
      <div className="map-container">
        <MapContainer center={[37.015, 27.420]} zoom={13} style={{ width: '100%', height: '100%' }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap &copy; CARTO"
          />

          <CourseClickHandler activeTool={activeTool} onPlacePoint={handleMapPoint} />
          <SelectedObjectFocus
            selectedCheckpointId={selectedCheckpointId}
            selectedLineEndpointIndex={selectedLineEndpointIndex}
            getCheckpoint={(id) => orderedCheckpoints.find(cp => cp.id === id)}
          />

          {pendingLinePoint && (activeTool === 'start' || activeTool === 'gate' || activeTool === 'finish') && (
            <>
              <Marker position={pendingLinePoint} icon={tempPointIcon} />
              <PendingLinePreview
                anchor={pendingLinePoint}
                kind={activeTool}
                crossing={pendingLineCrossing}
              />
            </>
          )}

          {orderedCheckpoints.map((checkpoint) => {
            if (checkpoint.type === 'buoy') {
              const isSelected = selectedCheckpoint?.id === checkpoint.id;
              return (
                <React.Fragment key={checkpoint.id}>
                  <Marker
                    position={checkpoint.coord}
                    icon={createRoundingBuoyIcon(checkpoint.rounding, checkpoint.id)}
                    draggable={isSelected}
                    autoPan={isSelected}
                    opacity={selectedCheckpoint ? (isSelected ? 1 : 0.4) : 1}
                    eventHandlers={{
                      click: (event) => {
                        L.DomEvent.stopPropagation(event.originalEvent);
                        selectCheckpoint(checkpoint.id, null);
                      },
                      dragend: (event) => {
                        if (!isSelected) return;
                        const { lat, lng } = event.target.getLatLng();
                        updateBuoyPosition(checkpoint.id, [lat, lng]);
                      },
                    }}
                  >
                    <Popup>
                      <div style={{ color: '#000' }}>
                        <strong>{checkpoint.id}</strong><br />
                        Turn: {checkpoint.rounding.toUpperCase()}
                      </div>
                    </Popup>
                  </Marker>
                  {isSelected && (
                    <CircleMarker
                      center={checkpoint.coord}
                      radius={24}
                      pathOptions={{
                        color: '#F26419',
                        fillColor: '#F26419',
                        fillOpacity: 0.08,
                        weight: 3,
                      }}
                    />
                  )}
                </React.Fragment>
              );
            }

            if (checkpoint.kind === 'start' || checkpoint.kind === 'finish' || checkpoint.kind === 'gate') {
              const isSelected = selectedCheckpoint?.id === checkpoint.id;
              const selectionColor = checkpoint.kind === 'start'
                ? '#DCFCE7'
                : checkpoint.kind === 'finish'
                  ? '#FECACA'
                  : '#FFFFFF';

              return (
                <React.Fragment key={checkpoint.id}>
                  {isSelected && (
                    <Polyline
                      positions={checkpoint.coords}
                      color={selectionColor}
                      weight={19}
                      opacity={checkpoint.kind === 'finish' ? 0.55 : 0.95}
                    />
                  )}
                  <RaceLineMarker
                    coords={checkpoint.coords}
                    kind={checkpoint.kind}
                    crossing={checkpoint.crossing}
                    opacity={selectedCheckpoint ? (isSelected ? 1 : 0.4) : 1}
                  />
                  {checkpoint.coords.map((point, index) => {
                    const isActiveEndpoint = isSelected && selectedLineEndpointIndex === index;
                    return (
                      <LineEndpointMarker
                        key={`${checkpoint.id}-end-${index}`}
                        position={point}
                        isActive={isActiveEndpoint}
                        label={`${checkpoint.id} endpoint ${index === 0 ? 'A' : 'B'}`}
                        onSelect={() => selectCheckpoint(checkpoint.id, index)}
                        onMove={(nextPoint) => updateLinePoint(checkpoint.id, index, nextPoint)}
                      />
                    );
                  })}
                </React.Fragment>
              );
            }
          })}
        </MapContainer>
      </div>

      <div className="committee-sidebar course-designer-sidebar">
        <div className="sidebar-section course-designer-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="eyebrow">RC Course</span>
              <h2>{course?.name || 'Course Designer'}</h2>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="icon-action" title="Open Course" onClick={handleOpenCoursesList}>
                <FolderOpen size={20} />
              </button>
              <button className="icon-action" title="Save Course" onClick={handleSaveCourseClick}>
                <Save size={20} />
              </button>
            </div>
          </div>
          <p style={{ marginTop: '8px' }}>Design the race sequence before validation begins.</p>
        </div>

        <div className="sidebar-section">
          <div className="tool-grid" aria-label="Course design tools">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const replacesExisting = singletonKinds.has(tool.id);
              return (
                <button
                  key={tool.id}
                  type="button"
                  className={activeTool === tool.id ? 'active' : ''}
                  title={replacesExisting ? `Replace ${tool.label}` : `Place ${tool.label}`}
                  onClick={() => resetPendingToolState(tool.id)}
                >
                  <Icon size={28} />
                  <span>{replacesExisting && (tool.id === 'start' || tool.id === 'finish') ? `Move ${tool.label}` : tool.label}</span>
                </button>
              );
            })}
          </div>

          <div className="placement-hint">
            <MousePointer2 size={24} />
            <span>{instruction}</span>
          </div>

          {pendingLinePoint && (activeTool === 'start' || activeTool === 'gate' || activeTool === 'finish') && (
            <>
              <div className="segmented-control wide" aria-label="Crossing direction while placing line">
                <button
                  type="button"
                  className={normalizeLineCrossing(pendingLineCrossing) === 'up' ? 'active' : ''}
                  onClick={() => setPendingLineCrossing('up')}
                >
                  Up
                </button>
                <button
                  type="button"
                  className={normalizeLineCrossing(pendingLineCrossing) === 'down' ? 'active' : ''}
                  onClick={() => setPendingLineCrossing('down')}
                >
                  Down
                </button>
              </div>
              <button type="button" className="text-action" onClick={() => setPendingLinePoint(null)}>
                <RotateCcw size={22} />
                <span>Clear endpoint</span>
              </button>
            </>
          )}
        </div>

        <div className="sidebar-section checkpoint-section">
          <div className="section-title-row">
            <h3>Course Objects</h3>
            <span>{orderedCheckpoints.length}</span>
          </div>

          <ul className="checkpoint-list">
            <DndContext 
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext 
                items={orderedCheckpoints.map(cp => cp.id)}
                strategy={verticalListSortingStrategy}
              >
                {orderedCheckpoints.map((checkpoint) => (
                  <SortableCheckpointItem 
                    key={checkpoint.id} 
                    checkpoint={checkpoint}
                    selectedCheckpoint={selectedCheckpoint}
                    selectCheckpoint={selectCheckpoint}
                    removeCheckpoint={removeCheckpoint}
                    onEditCoordinates={() => setIsCoordinateModalOpen(true)}
                    updateRounding={updateRounding}
                    updateLineCrossing={updateLineCrossing}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </ul>
        </div>

        {selectedCheckpoint && (
          <div className="sidebar-section selected-editor">
            <div className="section-title-row">
              <h3>Edit {selectedCheckpoint.id}</h3>
              <span>{selectedCheckpoint.kind === 'buoy' ? 'Buoy' : lineLabels[selectedCheckpoint.kind]}</span>
            </div>

            {selectedCheckpoint.kind === 'buoy' && (
              <div className="segmented-control wide" aria-label={`${selectedCheckpoint.id} turn direction`}>
                <button
                  type="button"
                  className={selectedCheckpoint.rounding === 'port' ? 'active' : ''}
                  onClick={() => updateRounding(selectedCheckpoint.id, 'port')}
                >
                  Port
                </button>
                <button
                  type="button"
                  className={selectedCheckpoint.rounding === 'starboard' ? 'active' : ''}
                  onClick={() => updateRounding(selectedCheckpoint.id, 'starboard')}
                >
                  Starboard
                </button>
              </div>
            )}

            {selectedCheckpoint.kind !== 'buoy' && (
              <>
                <div className="segmented-control wide" style={{ marginBottom: '8px' }}>
                  <button
                    type="button"
                    className={selectedCheckpoint.kind === 'start' ? 'active' : ''}
                    onClick={() => updateLineKind(selectedCheckpoint.id, 'start')}
                  >Start</button>
                  <button
                    type="button"
                    className={selectedCheckpoint.kind === 'gate' ? 'active' : ''}
                    onClick={() => updateLineKind(selectedCheckpoint.id, 'gate')}
                  >Gate</button>
                  <button
                    type="button"
                    className={selectedCheckpoint.kind === 'finish' ? 'active' : ''}
                    onClick={() => updateLineKind(selectedCheckpoint.id, 'finish')}
                  >Finish</button>
                </div>
                
                <div className="segmented-control wide" style={{ marginBottom: '16px' }}>
                  <button
                    type="button"
                    className={normalizeLineCrossing(selectedCheckpoint.crossing) === 'up' ? 'active' : ''}
                    onClick={() => updateLineCrossing(selectedCheckpoint.id, 'up')}
                  >Up</button>
                  <button
                    type="button"
                    className={normalizeLineCrossing(selectedCheckpoint.crossing) === 'down' ? 'active' : ''}
                    onClick={() => updateLineCrossing(selectedCheckpoint.id, 'down')}
                  >Down</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {isCoordinateModalOpen && selectedCheckpoint && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.6)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div style={{
            background: 'white', borderRadius: '16px', padding: '24px', 
            width: '100%', maxWidth: '400px', boxShadow: 'var(--shadow-xl)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.25rem', color: 'var(--text-primary)' }}>
              {selectedCheckpoint.id.toUpperCase()} Coordinates
            </h3>
            
            {selectedCheckpoint.kind === 'buoy' ? (
              <div className="coord-row editor-row">
                <label>
                  Lat
                  <input
                    type="number"
                    step="0.000001"
                    value={formatCoord(selectedCheckpoint.coord[0])}
                    onChange={(event) => updateBuoyCoord(
                      selectedCheckpoint.id,
                      0,
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  Lng
                  <input
                    type="number"
                    step="0.000001"
                    value={formatCoord(selectedCheckpoint.coord[1])}
                    onChange={(event) => updateBuoyCoord(
                      selectedCheckpoint.id,
                      1,
                      event.target.value,
                    )}
                  />
                </label>
              </div>
            ) : (
              <>
                <div className="coord-row editor-row with-endpoint">
                  <span className="endpoint-chip">A</span>
                  <label>Lat<input type="number" step="0.000001" value={formatCoord(selectedCheckpoint.coords[0][0])} onChange={(e) => updateLineCoord(selectedCheckpoint.id, 0, 0, e.target.value)} /></label>
                  <label>Lng<input type="number" step="0.000001" value={formatCoord(selectedCheckpoint.coords[0][1])} onChange={(e) => updateLineCoord(selectedCheckpoint.id, 0, 1, e.target.value)} /></label>
                </div>
                <div className="coord-row editor-row with-endpoint">
                  <span className="endpoint-chip">B</span>
                  <label>Lat<input type="number" step="0.000001" value={formatCoord(selectedCheckpoint.coords[1][0])} onChange={(e) => updateLineCoord(selectedCheckpoint.id, 1, 0, e.target.value)} /></label>
                  <label>Lng<input type="number" step="0.000001" value={formatCoord(selectedCheckpoint.coords[1][1])} onChange={(e) => updateLineCoord(selectedCheckpoint.id, 1, 1, e.target.value)} /></label>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button 
                className="action-button primary" 
                style={{ flex: 1 }}
                onClick={() => {
                  let text = '';
                  if (selectedCheckpoint.kind === 'buoy') {
                    text = `${selectedCheckpoint.coord[0].toFixed(6)}, ${selectedCheckpoint.coord[1].toFixed(6)}`;
                  } else {
                    text = `A: ${selectedCheckpoint.coords[0][0].toFixed(6)}, ${selectedCheckpoint.coords[0][1].toFixed(6)}\nB: ${selectedCheckpoint.coords[1][0].toFixed(6)}, ${selectedCheckpoint.coords[1][1].toFixed(6)}`;
                  }
                  navigator.clipboard.writeText(text);
                }}
              >
                Copy
              </button>
              <button 
                className="action-button secondary" 
                style={{ flex: 1 }}
                onClick={() => setIsCoordinateModalOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {isOpenModalVisible && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="modal-content" style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: 'var(--shadow-xl)' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Open Course</h3>
              <button type="button" className="icon-action" onClick={() => setIsOpenModalVisible(false)}>
                <X size={24} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {savedCourses.length === 0 ? (
                <p>No saved courses found.</p>
              ) : (
                savedCourses.map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC', padding: '12px', borderRadius: '8px' }}>
                    <div 
                      style={{ cursor: 'pointer', flex: 1, fontWeight: '500' }}
                      onClick={() => {
                        setCourse(c);
                        onCourseChange(c);
                        setIsOpenModalVisible(false);
                      }}
                    >
                      {c.name}
                    </div>
                    <button type="button" className="icon-action text-danger" onClick={() => handleDeleteCourse(c.id)}>
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {isSaveModalVisible && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="modal-content" style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: 'var(--shadow-xl)' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Save Course</h3>
              <button type="button" className="icon-action" onClick={() => setIsSaveModalVisible(false)}>
                <X size={24} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Save as new course:</label>
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  placeholder="Course Name..."
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '1rem', background: '#fff' }}
                />
                <button
                  type="button"
                  className="action-button primary"
                  onClick={() => handleConfirmSave(true)}
                  disabled={!newCourseName.trim()}
                >
                  Save As New
                </button>
              </div>
              <div style={{ borderTop: '1px solid #E2E8F0', margin: '8px 0' }} />
              <button
                type="button"
                className="action-button secondary"
                onClick={() => handleConfirmSave(false)}
              >
                Overwrite "{course?.name}"
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
