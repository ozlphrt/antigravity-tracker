import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import {
  CircleDot,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Plus,
  Route,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../../database/mockSupabase';
import RaceLineMarker from '../RaceLineMarker';
import { getLineMidpoint, lineCrossingLabel, normalizeLineCrossing } from '../../utils/raceLine';
import ElementPopup from './ElementPopup';
import CourseBottomSheet from './CourseBottomSheet';

// ─── Helpers ────────────────────────────────────────────────────────────────

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
      <div style="position:absolute;color:#1e293b;font-weight:900;font-size:13px;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">${id}</div>
    </div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

const lineEndpointHitIcon = (isActive) => new L.DivIcon({
  html: `<div class="line-endpoint-hit${isActive ? ' is-active' : ''}"></div>`,
  className: 'line-endpoint-hit-shell',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const createLineIdLabelIcon = (label, isSelected) => new L.DivIcon({
  html: `<div class="rc-line-id-label${isSelected ? ' is-selected' : ''}">${label}</div>`,
  className: 'rc-line-id-label-shell',
  iconSize: [48, 22],
  iconAnchor: [24, 30], // anchors above the line midpoint
});

const createId = (type, checkpoints) => {
  if (type === 'start') return 'S';
  if (type === 'finish') return 'F';

  const existingIds = new Set(checkpoints.map((cp) => cp.id));
  let count = 1;
  // Buoys: B1, B2… Gates: G1, G2…
  let nextId = type === 'gate' ? `G${count}` : `B${count}`;

  while (existingIds.has(nextId)) {
    count += 1;
    nextId = type === 'gate' ? `G${count}` : `B${count}`;
  }
  return nextId;
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
      // Migration: old plain-number IDs → B-prefix
      const id = `B${buoyCount}`;
      return { ...checkpoint, id, kind };
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
      return withLineCheckpoint(checkpoint, kind, kind === 'start' ? 'S' : 'F');
    }

    return {
      ...checkpoint,
      id: kind === 'start' ? 'S' : kind === 'finish' ? 'F' : checkpoint.id,
      kind,
    };
  });

  const lastStartIndex = normalized.findLastIndex((cp) => cp.kind === 'start');
  const lastFinishIndex = normalized.findLastIndex((cp) => cp.kind === 'finish');

  return normalized.filter((checkpoint, index) => {
    if (checkpoint.kind === 'start') return index === lastStartIndex;
    if (checkpoint.kind === 'finish') return index === lastFinishIndex;
    return true;
  });
};

const enforceCourseOrder = (checkpoints) => {
  const start = checkpoints.filter((cp) => cp.kind === 'start');
  const middle = checkpoints.filter((cp) => cp.kind !== 'start' && cp.kind !== 'finish');
  const finish = checkpoints.filter((cp) => cp.kind === 'finish');
  return [...start, ...middle, ...finish];
};

// ─── Map Child Components ────────────────────────────────────────────────────

/** Captures the Leaflet map instance into a ref */
function MapRefCapture({ mapRef }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
  }, [map, mapRef]);
  return null;
}

/** Forces Leaflet to recalculate size on mount */
function MapInvalidator() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const id = setTimeout(() => map.invalidateSize(), 400);
    return () => clearTimeout(id);
  }, [map]);
  return null;
}

/**
 * Tracks the screen position of the selected element and reports it up.
 * Runs inside MapContainer so it can call useMap().
 */
function PopupPositionTracker({ selectedCheckpoint, onPositionUpdate, onClear }) {
  const map = useMap();

  useEffect(() => {
    if (!selectedCheckpoint) {
      onClear();
      return () => {};
    }

    const getCenter = () => {
      if (selectedCheckpoint.kind === 'buoy') return selectedCheckpoint.coord;
      return getLineMidpoint(selectedCheckpoint.coords);
    };

    const update = () => {
      const latlng = getCenter();
      const pt = map.latLngToContainerPoint(latlng);
      onPositionUpdate(pt.x, pt.y);
    };

    update();
    map.on('move zoom zoomend viewreset resize', update);
    return () => map.off('move zoom zoomend viewreset resize', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedCheckpoint?.id, selectedCheckpoint?.coord, selectedCheckpoint?.coords]);

  return null;
}

/** Deselects on outside-click (tap on empty map) */
function MapDeselectHandler({ onDeselect, fabOpen, closeFab }) {
  useMapEvents({
    click: () => {
      if (fabOpen) { closeFab(); return; }
      onDeselect();
    },
  });
  return null;
}

/** Draggable endpoint marker for line edges */
function LineEndpointMarker({ position, isActive, label, onSelect, onMove }) {
  return (
    <Marker
      position={position}
      icon={lineEndpointHitIcon(isActive)}
      draggable={isActive}
      autoPan={isActive}
      title={label}
      eventHandlers={{
        click: (e) => { L.DomEvent.stopPropagation(e.originalEvent); onSelect(); },
        dragend: (e) => {
          if (!isActive) return;
          const { lat, lng } = e.target.getLatLng();
          onMove([lat, lng]);
        },
      }}
    />
  );
}

/** Dashed polyline connecting all course objects in sequence */
function CourseConnectingLine({ checkpoints }) {
  const positions = checkpoints.map((cp) =>
    cp.kind === 'buoy' ? cp.coord : getLineMidpoint(cp.coords),
  );
  if (positions.length < 2) return null;
  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: '#33658A',
        weight: 4,
        opacity: 0.85,
        className: 'course-connecting-line'
      }}
    />
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CommitteeMain({ courseDraft, onCourseChange }) {
  const [course, setCourse] = useState(null);
  const [draftCheckpoints, setDraftCheckpoints] = useState([]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState(null);
  const [selectedLineEndpointIndex, setSelectedLineEndpointIndex] = useState(null);

  // Floating popup position (screen px within the map container)
  const [popupX, setPopupX] = useState(null);
  const [popupY, setPopupY] = useState(null);

  // UI state
  const [fabOpen, setFabOpen] = useState(false);
  const [showCourseLines, setShowCourseLines] = useState(false);
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false);
  const [cornerMenuOpen, setCornerMenuOpen] = useState(false);

  // Save / Open modal state
  const [isOpenModalVisible, setIsOpenModalVisible] = useState(false);
  const [isSaveModalVisible, setIsSaveModalVisible] = useState(false);
  const [savedCourses, setSavedCourses] = useState([]);
  const [newCourseName, setNewCourseName] = useState('');

  // Map ref (for placing elements at map center)
  const mapRef = useRef(null);
  const containerRef = useRef(null);

  // ── Load ──
  useEffect(() => {
    if (courseDraft) {
      setCourse(courseDraft);
      setDraftCheckpoints(enforceCourseOrder(normalizeCourseObjects(courseDraft.checkpoints)));
      return;
    }
    supabase.getCourses().then((courses) => {
      const first = courses[0];
      setCourse(first);
      setDraftCheckpoints(enforceCourseOrder(normalizeCourseObjects(first.checkpoints)));
    });
  }, [courseDraft]);

  // ── Auto-sync ──
  useEffect(() => {
    if (!course) return;
    const cur = JSON.stringify(course?.checkpoints?.map((c) => ({ id: c.id, kind: c.kind, coords: c.coords, coord: c.coord, crossing: c.crossing, rounding: c.rounding })));
    const next = JSON.stringify(draftCheckpoints.map((c) => ({ id: c.id, kind: c.kind, coords: c.coords, coord: c.coord, crossing: c.crossing, rounding: c.rounding })));
    if (cur === next) return;
    onCourseChange({ ...course, checkpoints: draftCheckpoints });
  }, [course, draftCheckpoints, onCourseChange]);

  // ── Selection ──
  const selectCheckpoint = useCallback((id, endpointIndex = null) => {
    setSelectedCheckpointId(id);
    setSelectedLineEndpointIndex(endpointIndex);
    if (id === null) { setPopupX(null); setPopupY(null); }
    // Collapse bottom sheet when selecting via map tap
    setBottomSheetExpanded(false);
  }, []);

  const deselect = useCallback(() => {
    setSelectedCheckpointId(null);
    setSelectedLineEndpointIndex(null);
    setPopupX(null);
    setPopupY(null);
  }, []);

  const selectedCheckpoint = useMemo(
    () => draftCheckpoints.find((cp) => cp.id === selectedCheckpointId) || null,
    [draftCheckpoints, selectedCheckpointId],
  );

  // ── Place element at map center ──
  const placeAtCenter = useCallback((toolKind) => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();

    if (toolKind === 'buoy') {
      let newId;
      setDraftCheckpoints((prev) => {
        newId = createId('buoy', prev);
        const buoy = {
          id: newId,
          kind: 'buoy',
          type: 'buoy',
          coord: [center.lat, center.lng],
          rounding: 'port',
        };
        return enforceCourseOrder([...prev, buoy]);
      });
      // Select after state settles
      setTimeout(() => {
        setDraftCheckpoints((prev) => {
          const placed = prev.find((cp) => cp.kind === 'buoy' && cp.coord[0] === center.lat);
          if (placed) selectCheckpoint(placed.id, null);
          return prev;
        });
      }, 0);
    } else {
      // Line: place A ~60m west, B ~60m east
      const lngOffset = 0.0006;
      const coords = [
        [center.lat, center.lng - lngOffset],
        [center.lat, center.lng + lngOffset],
      ];
      setDraftCheckpoints((prev) => {
        const newId = createId(toolKind, prev);
        const line = { id: newId, kind: toolKind, type: 'gate', coords, crossing: 'up' };
        let next;
        if (toolKind === 'start' || toolKind === 'finish') {
          next = enforceCourseOrder(normalizeCourseObjects([...prev.filter((cp) => cp.kind !== toolKind), line]));
        } else {
          next = enforceCourseOrder([...prev, line]);
        }
        // Select the newly created line
        setTimeout(() => selectCheckpoint(newId, null), 0);
        return next;
      });
    }
  }, [selectCheckpoint]);

  // ── Mutation helpers ──
  const updateRounding = (id, rounding) =>
    setDraftCheckpoints((prev) => prev.map((cp) => (cp.id === id ? { ...cp, rounding } : cp)));

  const updateLineKind = (id, kind) => {
    const trackingId = Math.random().toString();
    setDraftCheckpoints((prev) => {
      const marked = prev.map((cp) => (cp.id === id ? { ...cp, kind, _tracking: trackingId } : cp));
      const next = enforceCourseOrder(normalizeCourseObjects(marked));
      
      const updated = next.find(cp => cp._tracking === trackingId);
      if (updated && selectedCheckpointId === id && updated.id !== id) {
        setTimeout(() => setSelectedCheckpointId(updated.id), 0);
      }
      
      return next.map(cp => {
        const { _tracking, ...rest } = cp;
        return rest;
      });
    });
  };

  const updateLineCrossing = (id, crossing) =>
    setDraftCheckpoints((prev) => prev.map((cp) =>
      cp.id === id ? { ...cp, crossing: normalizeLineCrossing(crossing) } : cp,
    ));

  const updateBuoyCoord = (id, coordIndex, value) =>
    setDraftCheckpoints((prev) => prev.map((cp) => {
      if (cp.id !== id) return cp;
      const coord = [...cp.coord];
      coord[coordIndex] = value;
      return { ...cp, coord };
    }));

  const updateBuoyPosition = (id, point) =>
    setDraftCheckpoints((prev) => prev.map((cp) => (cp.id === id ? { ...cp, coord: point } : cp)));

  const updateLineCoord = (id, pointIndex, coordIndex, value) =>
    setDraftCheckpoints((prev) => prev.map((cp) => {
      if (cp.id !== id) return cp;
      const coords = cp.coords.map((p) => [...p]);
      coords[pointIndex][coordIndex] = value;
      return { ...cp, coords };
    }));

  const updateLinePoint = (id, pointIndex, point) =>
    setDraftCheckpoints((prev) => prev.map((cp) => {
      if (cp.id !== id) return cp;
      const coords = cp.coords.map((p) => [...p]);
      coords[pointIndex] = point;
      return { ...cp, coords };
    }));

  const updateLineCoords = (id, newCoords) =>
    setDraftCheckpoints((prev) => prev.map((cp) => {
      if (cp.id !== id) return cp;
      return { ...cp, coords: newCoords };
    }));

  const removeCheckpoint = (id) => {
    setDraftCheckpoints((prev) => prev.filter((cp) => cp.id !== id));
    if (selectedCheckpointId === id) deselect();
  };

  const handleReorder = (activeId, overId) => {
    const trackingId = Math.random().toString();
    setDraftCheckpoints((items) => {
      const oldIndex = items.findIndex((cp) => cp.id === activeId);
      const newIndex = items.findIndex((cp) => cp.id === overId);
      const reordered = [...items];
      const moved = reordered.splice(oldIndex, 1)[0];
      moved._tracking = trackingId;
      reordered.splice(newIndex, 0, moved);
      
      const next = enforceCourseOrder(normalizeCourseObjects(reordered));
      
      if (selectedCheckpointId === activeId) {
        const updated = next.find(cp => cp._tracking === trackingId);
        if (updated && updated.id !== activeId) {
          setTimeout(() => setSelectedCheckpointId(updated.id), 0);
        }
      }
      
      return next.map(cp => {
        const { _tracking, ...rest } = cp;
        return rest;
      });
    });
  };

  // ── Save / Open ──
  const handleOpenCoursesList = () => {
    supabase.getCourses().then((courses) => {
      setSavedCourses(courses);
      setIsOpenModalVisible(true);
      setCornerMenuOpen(false);
    });
  };

  const handleSaveCourseClick = () => {
    setIsSaveModalVisible(true);
    setCornerMenuOpen(false);
  };

  const handleConfirmSave = (isNew) => {
    const finalName = isNew ? (newCourseName.trim() || 'New Course') : course.name;
    const finalId = isNew ? `course-${Date.now()}` : course.id;
    const courseToSave = { ...course, id: finalId, name: finalName, checkpoints: draftCheckpoints };
    supabase.saveCourse(courseToSave).then(() => {
      setCourse(courseToSave);
      onCourseChange(courseToSave);
      setIsSaveModalVisible(false);
      setNewCourseName('');
    });
  };

  const handleDeleteCourse = (id) => {
    supabase.deleteCourse(id).then(() => setSavedCourses((prev) => prev.filter((c) => c.id !== id)));
  };

  // ── Container dimensions for popup clamping ──
  const [containerSize, setContainerSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="rc-map-full" ref={containerRef}>
      {/* ── Map ── */}
      <MapContainer
        center={[37.015, 27.420]}
        zoom={13}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />
        <MapRefCapture mapRef={mapRef} />
        <MapInvalidator />
        <MapDeselectHandler
          onDeselect={deselect}
          fabOpen={fabOpen}
          closeFab={() => setFabOpen(false)}
        />
        <PopupPositionTracker
          selectedCheckpoint={selectedCheckpoint}
          onPositionUpdate={(x, y) => { setPopupX(x); setPopupY(y); }}
          onClear={() => { setPopupX(null); setPopupY(null); }}
        />

        {/* Course connecting polyline */}
        {showCourseLines && <CourseConnectingLine checkpoints={draftCheckpoints} />}

        {/* Course elements */}
        {draftCheckpoints.map((checkpoint) => {
          const isSelected = selectedCheckpoint?.id === checkpoint.id;

          if (checkpoint.kind === 'buoy') {
            return (
              <React.Fragment key={checkpoint.id}>
                <Marker
                  position={checkpoint.coord}
                  icon={createRoundingBuoyIcon(checkpoint.rounding, checkpoint.id)}
                  draggable={isSelected}
                  autoPan={isSelected}
                  opacity={selectedCheckpoint && !isSelected ? 0.4 : 1}
                  eventHandlers={{
                    click: (e) => { L.DomEvent.stopPropagation(e.originalEvent); selectCheckpoint(checkpoint.id, null); },
                    dragend: (e) => {
                      if (!isSelected) return;
                      const { lat, lng } = e.target.getLatLng();
                      updateBuoyPosition(checkpoint.id, [lat, lng]);
                    },
                  }}
                />
                {isSelected && (
                  <CircleMarker
                    center={checkpoint.coord}
                    radius={24}
                    pathOptions={{ color: '#F26419', fillColor: '#F26419', fillOpacity: 0.08, weight: 3 }}
                  />
                )}
              </React.Fragment>
            );
          }

          if (checkpoint.kind === 'start' || checkpoint.kind === 'finish' || checkpoint.kind === 'gate') {
            const selectionColor = checkpoint.kind === 'start' ? '#DCFCE7'
              : checkpoint.kind === 'finish' ? '#FECACA' : '#FFFFFF';

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
                  opacity={selectedCheckpoint && !isSelected ? 0.4 : 1}
                  interactive
                  eventHandlers={{
                    click: (e) => { L.DomEvent.stopPropagation(e.originalEvent); selectCheckpoint(checkpoint.id, null); },
                  }}
                />
                {/* ID label chip above line midpoint */}
                <Marker
                  key={`${checkpoint.id}-center-${isSelected}`}
                  position={getLineMidpoint(checkpoint.coords)}
                  icon={createLineIdLabelIcon(checkpoint.id, isSelected)}
                  interactive={true}
                  draggable={isSelected}
                  autoPan={isSelected}
                  zIndexOffset={300}
                  eventHandlers={{
                    click: (e) => { L.DomEvent.stopPropagation(e.originalEvent); selectCheckpoint(checkpoint.id, null); },
                    dragend: (e) => {
                      if (!isSelected) return;
                      const { lat, lng } = e.target.getLatLng();
                      const oldMidpoint = getLineMidpoint(checkpoint.coords);
                      const dLat = lat - oldMidpoint[0];
                      const dLng = lng - oldMidpoint[1];
                      const newCoords = checkpoint.coords.map(p => [p[0] + dLat, p[1] + dLng]);
                      updateLineCoords(checkpoint.id, newCoords);
                    }
                  }}
                />
                {/* Draggable endpoint handles */}
                {checkpoint.coords.map((point, index) => (
                  <LineEndpointMarker
                    key={`${checkpoint.id}-ep-${index}-${isSelected}`}
                    position={point}
                    isActive={isSelected}
                    label={`${checkpoint.id} point ${index === 0 ? 'A' : 'B'}`}
                    onSelect={() => selectCheckpoint(checkpoint.id, index)}
                    onMove={(pt) => updateLinePoint(checkpoint.id, index, pt)}
                  />
                ))}
              </React.Fragment>
            );
          }

          return null;
        })}
      </MapContainer>

      {/* ── Floating popup overlay ── */}
      {selectedCheckpoint && popupX != null && popupY != null && (
        <div className="rc-popup-overlay">
          <ElementPopup
            checkpoint={selectedCheckpoint}
            screenX={popupX}
            screenY={popupY}
            containerW={containerSize.w}
            containerH={containerSize.h}
            onUpdateRounding={updateRounding}
            onUpdateLineKind={updateLineKind}
            onUpdateLineCrossing={updateLineCrossing}
            onUpdateBuoyCoord={updateBuoyCoord}
            onUpdateLineCoord={updateLineCoord}
            onRemove={removeCheckpoint}
          />
        </div>
      )}

      {/* ── Corner toolbar ── */}
      <div className="rc-corner-toolbar">
        <button
          type="button"
          className="rc-corner-btn"
          aria-label="Course options"
          onClick={() => setCornerMenuOpen((v) => !v)}
        >
          {cornerMenuOpen ? <X size={18} /> : <MoreHorizontal size={18} />}
        </button>
        {cornerMenuOpen && (
          <div className="rc-corner-menu">
            <button type="button" onClick={handleSaveCourseClick}>
              <Save size={15} /> Save
            </button>
            <button type="button" onClick={handleOpenCoursesList}>
              <FolderOpen size={15} /> Open
            </button>
          </div>
        )}
      </div>

      {/* ── FAB stack ── */}
      <div className="rc-fab-stack" style={{ position: 'absolute' }}>
        {/* Course connecting line toggle */}
        <button
          type="button"
          className={`rc-course-line-btn${showCourseLines ? ' active' : ''}`}
          title="Toggle course route line"
          onClick={() => setShowCourseLines((v) => !v)}
        >
          <Route size={20} />
        </button>

        {/* FAB */}
        <div style={{ position: 'relative' }}>
          {fabOpen && (
            <div className="rc-fab-menu">
              <button type="button" onClick={() => { placeAtCenter('gate'); setFabOpen(false); }}>
                <GitBranch size={18} color="#33658A" /> Add Line
              </button>
              <button type="button" onClick={() => { placeAtCenter('buoy'); setFabOpen(false); }}>
                <CircleDot size={18} color="#F26419" /> Add Buoy
              </button>
              <div style={{ height: '1px', background: '#E2E8F0', margin: '4px 0' }} />
              <button type="button" onClick={() => { setFabOpen(false); setIsOpenModalVisible(true); }}>
                <FolderOpen size={18} color="#475569" /> Open Course
              </button>
              <button type="button" onClick={() => { setFabOpen(false); setIsSaveModalVisible(true); }}>
                <Save size={18} color="#475569" /> Save / Finish
              </button>
            </div>
          )}
          <button
            type="button"
            className={`rc-fab${fabOpen ? ' open' : ''}`}
            aria-label={fabOpen ? 'Close menu' : 'Add element'}
            onClick={() => setFabOpen((v) => !v)}
          >
            {fabOpen ? <X size={24} /> : <Plus size={24} />}
          </button>
        </div>
      </div>

      {/* ── Bottom sheet ── */}
      <CourseBottomSheet
        checkpoints={draftCheckpoints}
        expanded={bottomSheetExpanded}
        onToggle={() => setBottomSheetExpanded((v) => !v)}
        selectedId={selectedCheckpointId}
        onSelect={(id) => {
          selectCheckpoint(id, null);
          setBottomSheetExpanded(false);
        }}
        onReorder={handleReorder}
      />

      {/* ── Open modal ── */}
      {isOpenModalVisible && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Open Course</h3>
              <button type="button" className="icon-action" onClick={() => setIsOpenModalVisible(false)}>
                <X size={24} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {savedCourses.length === 0 ? (
                <p>No saved courses found.</p>
              ) : (
                savedCourses.map((c) => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC', padding: '12px', borderRadius: '8px' }}>
                    <div
                      style={{ cursor: 'pointer', flex: 1, fontWeight: '500' }}
                      onClick={() => { setCourse(c); onCourseChange(c); setIsOpenModalVisible(false); setDraftCheckpoints(enforceCourseOrder(normalizeCourseObjects(c.checkpoints))); }}
                    >
                      {c.name}
                    </div>
                    <button type="button" className="icon-action" onClick={() => handleDeleteCourse(c.id)}>
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Save modal ── */}
      {isSaveModalVisible && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Save Course</h3>
              <button type="button" className="icon-action" onClick={() => setIsSaveModalVisible(false)}>
                <X size={24} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
    </div>
  );
}
