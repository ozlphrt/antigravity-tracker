import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
  Tooltip,
  Circle
} from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';
import {
  CircleDot,
  FolderOpen,
  GitBranch,
  Info,
  MoreHorizontal,
  Plus,
  Minus,
  LocateFixed,
  Navigation,
  Route,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../../database/mockSupabase';
import RaceLineMarker from '../RaceLineMarker';
import { getLineLengthMeters, getLineMidpoint, lineCrossingLabel, normalizeLineCrossing } from '../../utils/raceLine';
import ElementPopup from './ElementPopup';
import CourseBottomSheet from './CourseBottomSheet';
import InteractiveSeamarksLayer from '../InteractiveSeamarksLayer';
import { useGpsTracker } from '../../hooks/useGpsTracker';

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
  const color = 'var(--accent-coral)';
  const svgPath = isPort
    ? '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'
    : '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>';
  const localClass = isPort ? 'buoy-spin-ccw-local' : 'buoy-spin-cw-local';

  return new L.DivIcon({
    html: `
      <style>
        @keyframes buoy-spin-ccw-kf {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        @keyframes buoy-spin-cw-kf {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .buoy-spin-ccw-local {
          animation: buoy-spin-ccw-kf 6s linear infinite !important;
          transform-origin: center !important;
          transform-box: fill-box !important;
          display: flex !important;
        }
        .buoy-spin-cw-local {
          animation: buoy-spin-cw-kf 6s linear infinite !important;
          transform-origin: center !important;
          transform-box: fill-box !important;
          display: flex !important;
        }
      </style>
      <div class="course-buoy-icon" style="width: 52px; height: 52px; display: flex; align-items: center; justify-content: center;">
        <div class="${localClass}" style="position: absolute; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            ${svgPath}
          </svg>
        </div>
        <div style="position:absolute;background:white;color:var(--text-primary);border:2px solid ${color};border-radius:50%;font-weight:900;font-size:13px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.35);">${id.replace(/\D/g, '')}</div>
      </div>`,
    className: 'buoy-marker-icon-shell',
    iconSize: [52, 52],
    iconAnchor: [26, 26],
  });
};

const lineEndpointHitIcon = (isActive) => new L.DivIcon({
  html: `<div class="line-endpoint-hit${isActive ? ' is-active' : ''}"></div>`,
  className: 'line-endpoint-hit-shell',
  iconSize: [48, 48],
  iconAnchor: [24, 24],
});

const createFloatingDeleteIcon = () => new L.DivIcon({
  html: `<div style="background-color: var(--accent-coral); border: 2.5px solid white; color: white; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 6px rgba(0,0,0,0.3); transition: transform 0.2s ease; cursor: pointer;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />
    </svg>
  </div>`,
  className: '',
  iconSize: [26, 26],
  iconAnchor: [13, 13]
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
  if (!checkpoints) return [];
  let buoyCount = 0;
  let gateCount = 0;

  const normalized = checkpoints.map((checkpoint) => {
    const kind = checkpoint.kind
      || (checkpoint.id === 'start' || checkpoint.id === 'S' ? 'start' : null)
      || (checkpoint.id === 'finish' || checkpoint.id === 'F' ? 'finish' : null)
      || checkpoint.type;

    let res;
    if (kind === 'buoy') {
      buoyCount += 1;
      const id = `B${buoyCount}`;
      res = { ...checkpoint, id, kind };
    } else if (kind === 'gate') {
      if (checkpoint.id === 'start' || checkpoint.id === 'finish') {
        const lineKind = checkpoint.id === 'start' ? 'start' : 'finish';
        res = withLineCheckpoint(checkpoint, lineKind, lineKind === 'start' ? 'S' : 'F');
      } else {
        gateCount += 1;
        res = withLineCheckpoint(checkpoint, 'gate', `G${gateCount}`);
      }
    } else if (kind === 'start' || kind === 'finish') {
      res = withLineCheckpoint(checkpoint, kind, kind === 'start' ? 'S' : 'F');
    } else {
      res = {
        ...checkpoint,
        id: kind === 'start' ? 'S' : kind === 'finish' ? 'F' : checkpoint.id,
        kind,
      };
    }

    // Auto-generate coords for line/gate checkpoints if missing
    if ((res.kind === 'start' || res.kind === 'finish' || res.kind === 'gate') && !res.coords) {
      if (res.coord) {
        const center = turf.point([res.coord[1], res.coord[0]]);
        const width = res.width || 300;
        const rotation = res.rotationDeg !== undefined ? res.rotationDeg : 270;
        
        const angleA = (rotation + 90) % 360;
        const angleB = (rotation - 90 + 360) % 360;
        const halfDistKm = (width / 2) / 1000;
        
        const ptA = turf.destination(center, halfDistKm, angleA, { units: 'kilometers' });
        const ptB = turf.destination(center, halfDistKm, angleB, { units: 'kilometers' });
        
        res.coords = [
          [ptA.geometry.coordinates[1], ptA.geometry.coordinates[0]],
          [ptB.geometry.coordinates[1], ptB.geometry.coordinates[0]]
        ];
      } else {
        const centerLng = 27.4601;
        const offset = 0.001685;
        res.coords = [
          [36.9758, centerLng - offset],
          [36.9758, centerLng + offset]
        ];
      }
    }

    return res;
  });

  const lastStartIndex = normalized.findLastIndex((cp) => cp.kind === 'start');
  const lastFinishIndex = normalized.findLastIndex((cp) => cp.kind === 'finish');

  return normalized.filter((checkpoint, index) => {
    if (checkpoint.kind === 'start') return index === lastStartIndex;
    if (checkpoint.kind === 'finish') return index === lastFinishIndex;
    return true;
  });
};

// Compute and attach lineLength (metres) for any line checkpoint that has coords
const attachLineLengths = (checkpoints) =>
  checkpoints.map((cp) => {
    if (cp.kind === 'buoy' || !cp.coords) return cp;
    return { ...cp, lineLength: Math.round(getLineLengthMeters(cp.coords)) };
  });

const enforceCourseOrder = (checkpoints) => {
  const start = checkpoints.filter((cp) => cp.kind === 'start');
  const middle = checkpoints.filter((cp) => cp.kind !== 'start' && cp.kind !== 'finish');
  const finish = checkpoints.filter((cp) => cp.kind === 'finish');
  const ordered = [...start, ...middle, ...finish];

  // Auto-align line crossings towards the next checkpoint (or away from previous for finish) if not manually overridden
  for (let i = 0; i < ordered.length; i++) {
    const cp = ordered[i];
    if ((cp.kind === 'start' || cp.kind === 'gate' || cp.kind === 'finish') && cp.coords && !cp.manualCrossing) {
      // Find reference checkpoint
      let refCp = null;
      const isFinish = cp.kind === 'finish';
      if (isFinish) {
        refCp = ordered[i - 1];
      } else {
        // Find first subsequent checkpoint that is not itself
        refCp = ordered.slice(i + 1).find(c => c.id !== cp.id);
      }

      if (refCp) {
        const cpMid = getLineMidpoint(cp.coords);
        let refCoord = refCp.coord;
        if (!refCoord && refCp.coords) {
          refCoord = getLineMidpoint(refCp.coords);
        }

        if (refCoord) {
          const ptMid = turf.point([cpMid[1], cpMid[0]]);
          const ptRef = turf.point([refCoord[1], refCoord[0]]);
          
           const desiredBearing = isFinish 
             ? turf.bearing(ptRef, ptMid)
             : turf.bearing(ptMid, ptRef);
 
           if (isFinish) {
              const width = cp.width || 120;
              const rotation = desiredBearing;
              if (Math.abs((cp.rotationDeg || 0) - rotation) > 0.01) {
                const angleA = (rotation + 90) % 360;
                const angleB = (rotation - 90 + 360) % 360;
                const halfDistKm = (width / 2) / 1000;
                const ptA = turf.destination(ptMid, halfDistKm, angleA, { units: 'kilometers' });
                const ptB = turf.destination(ptMid, halfDistKm, angleB, { units: 'kilometers' });
                cp.coords = [
                  [ptA.geometry.coordinates[1], ptA.geometry.coordinates[0]],
                  [ptB.geometry.coordinates[1], ptB.geometry.coordinates[0]]
                ];
                cp.rotationDeg = rotation;
              }
           }
 
           const ptA = turf.point([cp.coords[0][1], cp.coords[0][0]]);
           const ptB = turf.point([cp.coords[1][1], cp.coords[1][0]]);
           const lb = turf.bearing(ptA, ptB);

          const bearingUp = (lb - 90 + 360) % 360;
          const bearingDown = (lb + 90 + 360) % 360;

          let diffUp = Math.abs(desiredBearing - bearingUp);
          if (diffUp > 180) diffUp = 360 - diffUp;

          let diffDown = Math.abs(desiredBearing - bearingDown);
          if (diffDown > 180) diffDown = 360 - diffDown;

          cp.crossing = diffUp < diffDown ? 'up' : 'down';
        }
      }
    }
  }

  return ordered;
};

// ─── Map Child Components ────────────────────────────────────────────────────

function MapInitialLocationCenterer() {
  const map = useMap();
  const centeredRef = useRef(false);

  useEffect(() => {
    if (centeredRef.current || window.__hasCenteredOnUser) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (centeredRef.current || window.__hasCenteredOnUser) return;
        centeredRef.current = true;
        window.__hasCenteredOnUser = true;
        map.setView([pos.coords.latitude, pos.coords.longitude], 15.5);
      },
      (err) => {
        console.warn("Could not acquire initial geolocation", err);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }, [map]);

  return null;
}

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

/** Deselects on outside-click (tap on empty map) or spawns buoy on double-click */
function MapDeselectHandler({ onDeselect, onMapDblClick }) {
  const lastClickRef = useRef({ time: 0, x: 0, y: 0 });

  useMapEvents({
    click: (e) => {
      onDeselect();
      const now = Date.now();
      const { x, y } = e.containerPoint;
      const last = lastClickRef.current;
      const timeDiff = now - last.time;
      const dist = Math.hypot(x - last.x, y - last.y);

      if (timeDiff < 300 && dist < 10) {
        const { lat, lng } = e.latlng;
        onMapDblClick(lat, lng);
        lastClickRef.current = { time: 0, x: 0, y: 0 };
      } else {
        lastClickRef.current = { time: now, x, y };
      }
    }
  });
  return null;
}

function LineEndpointMarker({ position, isActive, label, onSelect, onDragStart }) {
  return (
    <Marker
      position={position}
      icon={lineEndpointHitIcon(isActive)}
      draggable={false}
      title={label}
      eventHandlers={{
        click: (e) => { L.DomEvent.stopPropagation(e.originalEvent); onSelect(); },
        mousedown: (e) => {
          if (!isActive) return;
          L.DomEvent.stopPropagation(e.originalEvent);
          onDragStart(e);
        },
        touchstart: (e) => {
          if (!isActive) return;
          L.DomEvent.stopPropagation(e.originalEvent);
          onDragStart(e);
        }
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
        dashArray: '12, 14',
        className: 'course-connecting-line',
        interactive: false
      }}
      interactive={false}
    />
  );
}

// ─── Map Controls ─────────────────────────────────────────────────────────────

function MapControls({ pos, autoCenter, setAutoCenter }) {
  const map = useMap();
  const lastCenterEnableTime = useRef(0);
  
  useEffect(() => {
    if (autoCenter && pos) {
      if (Date.now() - lastCenterEnableTime.current > 1200) {
        map.setView([pos.lat, pos.lng], map.getZoom(), { animate: false });
      }
    }
  }, [autoCenter, pos?.lat, pos?.lng, map]);

  useEffect(() => {
    const disableAuto = () => {
      setAutoCenter(false);
    };
    map.on('dragstart', disableAuto);
    return () => {
      map.off('dragstart', disableAuto);
    };
  }, [map, setAutoCenter]);

  return (
    <div style={{
      position: 'absolute',
      top: '70px',
      right: '15px',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }}>
      <button 
        title="Center on Boat"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!autoCenter) {
            lastCenterEnableTime.current = Date.now();
            if (pos) map.flyTo([pos.lat, pos.lng], 15.5, { duration: 1.2 });
          }
          setAutoCenter(prev => !prev);
        }}
        style={{
          background: autoCenter ? 'var(--accent-coral)' : 'white',
          border: '1px solid #F1F5F9',
          borderRadius: '50%',
          width: '44px',
          height: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-md)',
          cursor: 'pointer',
          color: autoCenter ? 'white' : 'var(--text-primary)'
        }}
      >
        <LocateFixed size={22} />
      </button>
      
      {/* Zoom Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
        <button 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              map.setZoom(map.getZoom() + 0.5, { animate: true });
            }}
          style={{
            background: 'white',
            border: '1px solid #F1F5F9',
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-md)',
            cursor: 'pointer',
            color: 'var(--text-secondary)'
          }}
        >
          <Plus size={22} />
        </button>
        
        <button 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              map.setZoom(map.getZoom() - 0.5, { animate: true });
            }}
          style={{
            background: 'white',
            border: '1px solid #F1F5F9',
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-md)',
            cursor: 'pointer',
            color: 'var(--text-secondary)'
          }}
        >
          <Minus size={22} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CommitteeMain({ courseDraft, onCourseChange, onStatusChange }) {
  const [course, setCourse] = useState(null);
  const [draftCheckpoints, setDraftCheckpoints] = useState([]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState(null);
  const [selectedLineEndpointIndex, setSelectedLineEndpointIndex] = useState(null);
  const [hoveredLineId, setHoveredLineId] = useState(null);
  const [draggingCheckpointId, setDraggingCheckpointId] = useState(null);
  const [placementChoiceCoords, setPlacementChoiceCoords] = useState(null); // { lat, lng }

  // RC GPS live tracking
  const [isRcLiveMode, setIsRcLiveMode] = useState(true);
  const { position: rcPosition } = useGpsTracker('rc-1', isRcLiveMode);
  const [autoCenter, setAutoCenter] = useState(true);

  useEffect(() => {
    if (onStatusChange) {
      onStatusChange({
        state: isRcLiveMode && rcPosition ? 'online' : (isRcLiveMode ? 'searching' : 'offline'),
        resolution: isRcLiveMode && rcPosition?.accuracy ? `± ${rcPosition.accuracy.toFixed(1)}m` : '± 4.2m (Sim)'
      });
    }
  }, [isRcLiveMode, rcPosition, onStatusChange]);

  // Floating popup position (screen px within the map container)
  const [popupX, setPopupX] = useState(null);
  const [popupY, setPopupY] = useState(null);

  // UI state
  const [showCourseLines, setShowCourseLines] = useState(false);
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false);

  // Save / Open modal state
  const [isOpenModalVisible, setIsOpenModalVisible] = useState(false);
  const [isSaveModalVisible, setIsSaveModalVisible] = useState(false);
  const [savedCourses, setSavedCourses] = useState([]);
  const [newCourseName, setNewCourseName] = useState('');

  // Simulated Boat Position (for starting location in BoatPwaMain)
  const [simulatedBoatPos, setSimulatedBoatPos] = useState(() => {
    const saved = localStorage.getItem('simulated_boat_pos');
    return saved ? JSON.parse(saved) : { lat: 36.9758, lng: 27.4601 };
  });

  const handleSimBoatDragEnd = (e) => {
    const latlng = e.target.getLatLng();
    const newPos = { lat: latlng.lat, lng: latlng.lng };
    setSimulatedBoatPos(newPos);
    localStorage.setItem('simulated_boat_pos', JSON.stringify(newPos));
  };

  // Map ref (for placing elements at map center)
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const lastFittedCourseIdRef = useRef(null);


  // Auto-calculated Sim Position (300m behind start line)
  const autoSimPos = useMemo(() => {
    const isRaceTarget = (cp) => cp.kind === 'start' || cp.kind === 'finish' || cp.kind === 'gate' || cp.kind === 'buoy';
    const targets = draftCheckpoints.filter(isRaceTarget);
    const startIdx = targets.findIndex(cp => cp.kind === 'start');
    
    if (startIdx !== -1) {
      const startLine = targets[startIdx];
      const sLat = (startLine.coords[0][0] + startLine.coords[1][0]) / 2;
      const sLng = (startLine.coords[0][1] + startLine.coords[1][1]) / 2;
      const startPt = turf.point([sLng, sLat]);
      
      let arrowBearing = 0;
      if (startLine.crossing === 'center') {
        arrowBearing = startLine.rotationDeg || 0;
      } else {
        const ptA = turf.point([startLine.coords[0][1], startLine.coords[0][0]]);
        const ptB = turf.point([startLine.coords[1][1], startLine.coords[1][0]]);
        const lineBearing = turf.bearing(ptA, ptB);
        const crossingSide = startLine.crossing || 'up';
        arrowBearing = (lineBearing + (crossingSide === 'up' ? -90 : 90) + 360) % 360;
      }
      
      const reverseBearing = (arrowBearing + 180) % 360;
      const spawnPt = turf.destination(startPt, 0.4, reverseBearing, { units: 'kilometers' }); // 400m behind start line
      const [spawnLng, spawnLat] = spawnPt.geometry.coordinates;
      
      return { lat: spawnLat, lng: spawnLng };
    }
    return null;
  }, [draftCheckpoints]);

  // ── Load ──
  useEffect(() => {
    if (courseDraft) {
      if (!course || courseDraft.id !== course.id) {
        lastFittedCourseIdRef.current = null;
      }
      setCourse(courseDraft);
      setDraftCheckpoints(attachLineLengths(enforceCourseOrder(normalizeCourseObjects(courseDraft.checkpoints))));
      return;
    }
    supabase.getCourses().then((courses) => {
      const first = courses[0];
      if (first) {
        if (!course || first.id !== course.id) {
          lastFittedCourseIdRef.current = null;
        }
        setCourse(first);
        setDraftCheckpoints(attachLineLengths(enforceCourseOrder(normalizeCourseObjects(first.checkpoints))));
      }
    });
  }, [courseDraft]);

  // ── Auto-sync ──
  useEffect(() => {
    const cur = course ? JSON.stringify(course?.checkpoints?.map((c) => ({ id: c.id, kind: c.kind, coords: c.coords, coord: c.coord, crossing: c.crossing, rounding: c.rounding, lineLength: c.lineLength }))) : null;
    const next = JSON.stringify(draftCheckpoints.map((c) => ({ id: c.id, kind: c.kind, coords: c.coords, coord: c.coord, crossing: c.crossing, rounding: c.rounding, lineLength: c.lineLength })));
    if (cur === next) return;
    onCourseChange({ ...(course || { id: 'live-draft', name: 'Draft Course' }), checkpoints: draftCheckpoints });
  }, [course, draftCheckpoints, onCourseChange]);

  // ── Fit Bounds on Course Load/Save ──
  useEffect(() => {
    if (!course || !course.checkpoints || course.checkpoints.length === 0) return;
    if (lastFittedCourseIdRef.current === course.id) return;
    
    const isInitial = lastFittedCourseIdRef.current === null;
    lastFittedCourseIdRef.current = course.id;
    
    if (isInitial && window.__hasCenteredOnUser) {
      return;
    }
    
    const fit = () => {
      if (!mapRef.current) return;
      const pts = [];
      course.checkpoints.forEach(cp => {
        if (cp.coord) pts.push(cp.coord);
        if (cp.coords) { pts.push(cp.coords[0]); pts.push(cp.coords[1]); }
      });
      if (pts.length > 0) {
        mapRef.current.fitBounds(pts, { padding: [50, 50], animate: true, maxZoom: 16 });
      }
    };
    if (mapRef.current) fit();
    else setTimeout(fit, 300);
  }, [course]);


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

  // ── Place element at specific coordinates or map center ──
  const placeElement = useCallback((lat, lng, toolKind) => {
    let kind = toolKind;
    if (draftCheckpoints.length === 0) kind = 'start';

    if (kind === 'buoy') {
      let newId;
      setDraftCheckpoints((prev) => {
        newId = createId('buoy', prev);
        const buoy = {
          id: newId,
          kind: 'buoy',
          type: 'buoy',
          coord: [lat, lng],
          rounding: 'port',
        };
        return enforceCourseOrder([...prev, buoy]);
      });
      // Select after state settles
      setTimeout(() => {
        setDraftCheckpoints((prev) => {
          const placed = prev.find((cp) => cp.kind === 'buoy' && cp.coord[0] === lat && cp.coord[1] === lng);
          if (placed) selectCheckpoint(placed.id, null);
          return prev;
        });
      }, 0);
    } else {
      // Line: place A 150m west, B 150m east (total 300m initial length)
      const lngOffset = 0.001685;
      const coords = [
        [lat, lng - lngOffset],
        [lat, lng + lngOffset],
      ];
      setDraftCheckpoints((prev) => {
        const newId = createId(kind, prev);
        const line = { id: newId, kind: kind, type: 'gate', coords, crossing: 'up' };
        let next;
        if (kind === 'start' || kind === 'finish') {
          next = enforceCourseOrder(normalizeCourseObjects([...prev.filter((cp) => cp.kind !== kind), line]));
        } else {
          next = enforceCourseOrder([...prev, line]);
        }
        // Select the newly created line
        setTimeout(() => selectCheckpoint(newId, null), 0);
        return next;
      });
    }
  }, [selectCheckpoint, draftCheckpoints]);

  const placeAtCenter = useCallback((toolKind) => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    placeElement(center.lat, center.lng, toolKind);
  }, [placeElement]);

  // ── Mutation helpers ──
  const updateRounding = (id, rounding) =>
    setDraftCheckpoints((prev) => prev.map((cp) => (cp.id === id ? { ...cp, rounding } : cp)));

  const updateLineKind = (id, kind) => {
    let newId = id;
    if (kind === 'start') newId = 'S';
    else if (kind === 'finish') newId = 'F';

    setDraftCheckpoints((prev) => {
      let filtered = prev;
      if (kind === 'start') filtered = prev.filter(cp => cp.kind !== 'start' || cp.id === id);
      if (kind === 'finish') filtered = prev.filter(cp => cp.kind !== 'finish' || cp.id === id);

      const next = filtered.map((cp) => (cp.id === id ? { ...cp, id: newId, kind } : cp));
      return enforceCourseOrder(normalizeCourseObjects(next));
    });

    if (selectedCheckpointId === id && newId !== id) {
      setSelectedCheckpointId(newId);
    }
  };

  const updateLineCrossing = (id, crossing) =>
    setDraftCheckpoints((prev) => prev.map((cp) =>
      cp.id === id ? { ...cp, crossing: normalizeLineCrossing(crossing), manualCrossing: true } : cp,
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

  // Helper to extract latlng from mouse or touch event on map/marker
  const getEventLatLng = useCallback((event, leafMap) => {
    if (event.latlng) return event.latlng;
    if (event.target && typeof event.target.getLatLng === 'function') {
      return event.target.getLatLng();
    }
    const orig = event.originalEvent || event;
    if (orig) {
      const touch = orig.touches?.[0] || orig.changedTouches?.[0];
      if (touch) {
        return leafMap.mouseEventToLatLng(touch);
      }
      // Bypasses desktop mouseEventToLatLng if coordinates exist directly
      return leafMap.mouseEventToLatLng(orig);
    }
    return null;
  }, []);

  const startBuoyDrag = useCallback((id, initialCoord, startEvent) => {
    const map = mapRef.current;
    if (!map) return;

    // Prevent mobile page scroll/pan on touchstart
    if (startEvent.originalEvent?.cancelable) {
      startEvent.originalEvent.preventDefault();
    }

    map.dragging.disable();
    if (map.doubleClickZoom) map.doubleClickZoom.disable();
    document.body.classList.add('dragging-active');
    setDraggingCheckpointId(id);

    const startLatLng = getEventLatLng(startEvent, map);

    const onMouseMove = (e) => {
      if (e.originalEvent?.cancelable) {
        e.originalEvent.preventDefault();
      }
      const latlng = getEventLatLng(e, map);
      if (!latlng || !startLatLng) return;
      const dLat = latlng.lat - startLatLng.lat;
      const dLng = latlng.lng - startLatLng.lng;
      updateBuoyPosition(id, [initialCoord[0] + dLat, initialCoord[1] + dLng]);
    };

    const onMouseUp = () => {
      map.off('mousemove touchmove', onMouseMove);
      map.off('mouseup dragend touchend', onMouseUp);
      map.dragging.enable();
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
      document.body.classList.remove('dragging-active');
      setDraggingCheckpointId(null);
      selectCheckpoint(id, null);
    };

    map.on('mousemove touchmove', onMouseMove);
    map.on('mouseup dragend touchend', onMouseUp);
  }, [selectCheckpoint, updateBuoyPosition, getEventLatLng]);

  const startLineDrag = useCallback((id, initialCoords, startEvent) => {
    const map = mapRef.current;
    if (!map) return;

    if (startEvent.originalEvent?.cancelable) {
      startEvent.originalEvent.preventDefault();
    }

    map.dragging.disable();
    if (map.doubleClickZoom) map.doubleClickZoom.disable();
    document.body.classList.add('dragging-active');
    setDraggingCheckpointId(id);

    const startLatLng = getEventLatLng(startEvent, map);

    const onMouseMove = (e) => {
      if (e.originalEvent?.cancelable) {
        e.originalEvent.preventDefault();
      }
      const latlng = getEventLatLng(e, map);
      if (!latlng || !startLatLng) return;
      const dLat = latlng.lat - startLatLng.lat;
      const dLng = latlng.lng - startLatLng.lng;
      const newCoords = initialCoords.map(p => [p[0] + dLat, p[1] + dLng]);
      updateLineCoords(id, newCoords);
    };

    const onMouseUp = () => {
      map.off('mousemove touchmove', onMouseMove);
      map.off('mouseup dragend touchend', onMouseUp);
      map.dragging.enable();
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
      document.body.classList.remove('dragging-active');
      setDraggingCheckpointId(null);
      selectCheckpoint(id, null);
    };

    map.on('mousemove touchmove', onMouseMove);
    map.on('mouseup dragend touchend', onMouseUp);
  }, [selectCheckpoint, updateLineCoords, getEventLatLng]);

  const startEndpointDrag = useCallback((id, index, initialPoint, startEvent) => {
    const map = mapRef.current;
    if (!map) return;

    if (startEvent.originalEvent?.cancelable) {
      startEvent.originalEvent.preventDefault();
    }

    map.dragging.disable();
    if (map.doubleClickZoom) map.doubleClickZoom.disable();
    document.body.classList.add('dragging-active');
    setDraggingCheckpointId(`${id}-ep-${index}`);

    const startLatLng = getEventLatLng(startEvent, map);

    const onMouseMove = (e) => {
      if (e.originalEvent?.cancelable) {
        e.originalEvent.preventDefault();
      }
      const latlng = getEventLatLng(e, map);
      if (!latlng || !startLatLng) return;
      const dLat = latlng.lat - startLatLng.lat;
      const dLng = latlng.lng - startLatLng.lng;
      updateLinePoint(id, index, [initialPoint[0] + dLat, initialPoint[1] + dLng]);
    };

    const onMouseUp = () => {
      map.off('mousemove touchmove', onMouseMove);
      map.off('mouseup dragend touchend', onMouseUp);
      map.dragging.enable();
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
      document.body.classList.remove('dragging-active');
      setDraggingCheckpointId(null);
      selectCheckpoint(id, index);
    };

    map.on('mousemove touchmove', onMouseMove);
    map.on('mouseup dragend touchend', onMouseUp);
  }, [selectCheckpoint, updateLinePoint, getEventLatLng]);

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
    });
  };

  const handleSaveCourseClick = () => {
    setIsSaveModalVisible(true);
  };

  const handleConfirmSave = (isNew) => {
    const finalName = isNew ? (newCourseName.trim() || 'New Course') : (course?.name || 'New Course');
    const finalId = isNew ? `course-${Date.now()}` : (course?.id || `course-${Date.now()}`);
    const courseToSave = { ...(course || {}), id: finalId, name: finalName, checkpoints: attachLineLengths(draftCheckpoints) };
    supabase.saveCourse(courseToSave).then(() => {
      setCourse(courseToSave);
      onCourseChange(courseToSave);
      setIsSaveModalVisible(false);
      setNewCourseName('');
    });
  };

  const handleClearCourse = () => {
    if (window.confirm("Are you sure you want to clear the current draft and start fresh?")) {
      setDraftCheckpoints([]);
      setCourse(null);
      onCourseChange(null);
      deselect();
    }
  };

  const handleDeleteCourse = (id) => {
    supabase.deleteCourse(id).then(() => {
      setSavedCourses((prev) => prev.filter((c) => c.id !== id));
      if (course?.id === id) {
        setCourse(null);
        setDraftCheckpoints([]);
        onCourseChange(null);
      }
    });
  };

  // ── Container dimensions for popup clamping ──
  const [containerSize, setContainerSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, height });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);


  return (
    <div className="rc-map-full" ref={containerRef}>
      {/* ── Map ── */}
      <MapContainer
        center={[36.9758, 27.4601]}
        zoom={15.5}
        zoomSnap={0.1}
        style={{ width: '100%', height: '100%', background: '#0b0f19' }}
        ref={mapRef}
        zoomControl={false}
        preferCanvas={true}
        maxZoom={22}
        doubleClickZoom={false}
      >
        <MapInitialLocationCenterer />
        <MapControls pos={isRcLiveMode ? rcPosition : (autoSimPos || simulatedBoatPos)} autoCenter={autoCenter} setAutoCenter={setAutoCenter} />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={22}
          maxNativeZoom={19}
        />
        <InteractiveSeamarksLayer />
        <MapRefCapture mapRef={mapRef} />
        <MapInvalidator />
        <MapDeselectHandler
          onDeselect={deselect}
          onMapDblClick={(lat, lng) => setPlacementChoiceCoords({ lat, lng })}
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
                  draggable={false}
                  opacity={selectedCheckpoint && !isSelected ? 0.4 : 1}
                  eventHandlers={{
                    click: (e) => { L.DomEvent.stopPropagation(e.originalEvent); selectCheckpoint(checkpoint.id, null); },
                    dblclick: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      const nextRounding = checkpoint.rounding === 'port' ? 'starboard' : 'port';
                      updateRounding(checkpoint.id, nextRounding);
                    },
                    mousedown: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      startBuoyDrag(checkpoint.id, checkpoint.coord, e);
                    },
                    touchstart: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      startBuoyDrag(checkpoint.id, checkpoint.coord, e);
                    },
                  }}
                />
                <CircleMarker
                  center={checkpoint.coord}
                  radius={24}
                  pathOptions={{
                    color: '#F26419',
                    fillColor: '#F26419',
                    fillOpacity: isSelected ? 0.08 : 0,
                    weight: isSelected ? 3 : 0,
                    opacity: isSelected ? 1 : 0
                  }}
                  interactive={false}
                />
                {/* Active dragging glow ring */}
                <CircleMarker
                  center={checkpoint.coord}
                  radius={28}
                  pathOptions={{
                    color: '#06b6d4',
                    fillColor: '#06b6d4',
                    fillOpacity: draggingCheckpointId === checkpoint.id ? 0.18 : 0,
                    weight: draggingCheckpointId === checkpoint.id ? 4 : 0,
                    opacity: draggingCheckpointId === checkpoint.id ? 1 : 0,
                    dashArray: '6, 6',
                  }}
                  interactive={false}
                />
              </React.Fragment>
            );
          }

          if (checkpoint.kind === 'start' || checkpoint.kind === 'finish' || checkpoint.kind === 'gate') {
            const selectionColor = checkpoint.kind === 'start' ? '#DCFCE7'
              : checkpoint.kind === 'finish' ? '#FECACA' : '#FFFFFF';
            const midpoint = getLineMidpoint(checkpoint.coords);

            return (
              <React.Fragment key={checkpoint.id}>
                <Polyline
                  positions={checkpoint.coords}
                  pathOptions={{
                    color: selectionColor,
                    weight: 19,
                    opacity: isSelected ? (checkpoint.kind === 'finish' ? 0.55 : 0.95) : 0,
                  }}
                  interactive={false}
                />
                {/* Active drag highlight line */}
                <Polyline
                  positions={checkpoint.coords}
                  pathOptions={{
                    color: '#06b6d4',
                    weight: 22,
                    opacity: draggingCheckpointId === checkpoint.id ? 0.85 : 0,
                    dashArray: '10, 10',
                  }}
                  interactive={false}
                />
                {/* Visual hover highlight polyline, shows up when user pointer is near the line */}
                <Polyline
                  positions={checkpoint.coords}
                  pathOptions={{
                    color: checkpoint.kind === 'start' ? '#4ade80' : checkpoint.kind === 'finish' ? '#f87171' : '#fbbf24',
                    weight: 15,
                    opacity: (hoveredLineId === checkpoint.id && !isSelected) ? 0.45 : 0,
                  }}
                  interactive={false}
                />
                {/* Thick invisible interaction area spanning the line coordinates to make it easy to select/drag from anywhere */}
                <Polyline
                  positions={checkpoint.coords}
                  pathOptions={{
                    color: '#ffffff',
                    opacity: 0.01, // extremely faint solid color so browser hit test registers mouseover/out events
                    weight: 32,
                  }}
                  interactive={true}
                  eventHandlers={{
                    click: (e) => { L.DomEvent.stopPropagation(e.originalEvent); selectCheckpoint(checkpoint.id, null); },
                    mousedown: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      startLineDrag(checkpoint.id, checkpoint.coords, e);
                    },
                    touchstart: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      startLineDrag(checkpoint.id, checkpoint.coords, e);
                    },
                    mouseover: () => setHoveredLineId(checkpoint.id),
                    mouseout: () => setHoveredLineId(null),
                  }}
                />
                <RaceLineMarker
                  coords={checkpoint.coords}
                  kind={checkpoint.kind}
                  crossing={checkpoint.crossing}
                  opacity={selectedCheckpoint && !isSelected ? 0.4 : 1}
                  interactive={true}
                  eventHandlers={{
                    click: (e) => { L.DomEvent.stopPropagation(e.originalEvent); selectCheckpoint(checkpoint.id, null); },
                    mousedown: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      startLineDrag(checkpoint.id, checkpoint.coords, e);
                    },
                    touchstart: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      startLineDrag(checkpoint.id, checkpoint.coords, e);
                    },
                    mouseover: () => setHoveredLineId(checkpoint.id),
                    mouseout: () => setHoveredLineId(null),
                  }}
                />
                {/* ID label chip above line midpoint */}
                <Marker
                  key={`${checkpoint.id}-center`}
                  position={midpoint}
                  icon={createLineIdLabelIcon(checkpoint.id, isSelected)}
                  interactive={true}
                  draggable={false}
                  zIndexOffset={300}
                  eventHandlers={{
                    click: (e) => { L.DomEvent.stopPropagation(e.originalEvent); selectCheckpoint(checkpoint.id, null); },
                    dblclick: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      const nextCrossing = checkpoint.crossing === 'up' ? 'down' : 'up';
                      updateLineCrossing(checkpoint.id, nextCrossing);
                    },
                    mousedown: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      startLineDrag(checkpoint.id, checkpoint.coords, e);
                    },
                    touchstart: (e) => {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      startLineDrag(checkpoint.id, checkpoint.coords, e);
                    },
                    mouseover: () => setHoveredLineId(checkpoint.id),
                    mouseout: () => setHoveredLineId(null),
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
                    onDragStart={(e) => startEndpointDrag(checkpoint.id, index, point, e)}
                  />
                ))}
              </React.Fragment>
            );
          }

          return null;
        })}

        {/* RC vessel GPS marker */}
        {isRcLiveMode && rcPosition && (
          <Marker
            position={[rcPosition.lat, rcPosition.lng]}
            icon={new L.DivIcon({
              html: `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0px 4px 6px rgba(0,0,0,0.3));transform:rotate(0deg);">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#33658A" stroke="#fff" stroke-width="2" stroke-linejoin="round" width="30" height="30"><path d="M12 2 L19 21 Q12 18 5 21 Z"/></svg>
              </div>`,
              className: 'boat-marker-icon-shell',
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            })}
          />
        )}

        {/* Simulated Boat Starting Locator (Sim Mode Only) */}
        {!isRcLiveMode && (
          <Marker
            position={autoSimPos ? [autoSimPos.lat, autoSimPos.lng] : [simulatedBoatPos.lat, simulatedBoatPos.lng]}
            draggable={!autoSimPos}
            eventHandlers={!autoSimPos ? { dragend: handleSimBoatDragEnd } : undefined}
            icon={new L.DivIcon({
              html: `<div style=\"width:30px;height:30px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0px 4px 6px rgba(0,0,0,0.3));\" title=\"${autoSimPos ? 'Auto-placed behind start line' : 'Drag to set Sim Start Position'}\">
                  <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"#33658A\" stroke=\"#fff\" stroke-width=\"2\" stroke-linejoin=\"round\" width=\"30\" height=\"30\"><path d=\"M12 2 L19 21 Q12 18 5 21 Z\"/></svg>
                </div>`,
              className: 'boat-marker-icon-shell',
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            })}
          />
        )}
      </MapContainer>



      {/* ── Floating popup overlay ── */}
      {selectedCheckpoint && !draggingCheckpointId && popupX != null && popupY != null && (
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

      <div className="rc-corner-toolbar" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      </div>

      {/* ── FAB stack ── */}
      <div className="rc-fab-stack" style={{ position: 'absolute' }}>
        {/* Add Line directly */}
        <button
          type="button"
          className="rc-course-line-btn"
          title="Add Line"
          onClick={() => placeAtCenter('gate')}
        >
          <GitBranch size={20} color="#33658A" />
        </button>

        {/* Add Buoy directly */}
        <button
          type="button"
          className="rc-course-line-btn"
          title="Add Buoy"
          onClick={() => placeAtCenter('buoy')}
        >
          <CircleDot size={20} color="#F26419" />
        </button>

        {/* Course connecting line toggle */}
        <button
          type="button"
          className={`rc-course-line-btn${showCourseLines ? ' active' : ''}`}
          title="Toggle course route line"
          onClick={() => setShowCourseLines((v) => !v)}
        >
          <Route size={20} />
        </button>

        {/* Save Course */}
        <button
          type="button"
          className="rc-course-line-btn"
          title="Save Course"
          onClick={handleSaveCourseClick}
        >
          <Save size={20} />
        </button>

        {/* Clear Draft */}
        <button
          type="button"
          className="rc-course-line-btn"
          title="Clear Draft"
          onClick={handleClearCourse}
          disabled={draftCheckpoints.length === 0}
          style={{ opacity: draftCheckpoints.length === 0 ? 0.5 : 1 }}
        >
          <Trash2 size={20} color="#EF4444" />
        </button>

        {/* Open Course */}
        <button
          type="button"
          className="rc-course-line-btn"
          title="Open Course"
          onClick={handleOpenCoursesList}
        >
          <FolderOpen size={20} />
        </button>
      </div>

      {/* ── Instructional overlay when empty ── */}
      {draftCheckpoints.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          background: 'rgba(15, 23, 42, 0.9)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          padding: '12px 20px',
          borderRadius: '12px',
          color: 'white',
          boxShadow: 'var(--shadow-lg)',
          fontSize: '0.875rem',
          pointerEvents: 'none',
          textAlign: 'center',
          width: '90%',
          maxWidth: '360px',
          boxSizing: 'border-box'
        }}>
          💡 <strong>Double-click</strong> on the map or use the <strong>buoy/line buttons</strong> on the right to start designing your course.
        </div>
      )}

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
        onRemove={removeCheckpoint}
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
                      onClick={() => {
                        lastFittedCourseIdRef.current = null;
                        setCourse(c);
                        onCourseChange(c);
                        setIsOpenModalVisible(false);
                        setDraftCheckpoints(enforceCourseOrder(normalizeCourseObjects(c.checkpoints)));
                      }}
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
                disabled={!course}
                style={{ opacity: course ? 1 : 0.5, cursor: course ? 'pointer' : 'not-allowed' }}
              >
                {course ? `Overwrite "${course.name}"` : 'Overwrite (No course active)'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Element Choice Overlay Modal ── */}
      {placementChoiceCoords && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '320px', boxShadow: 'var(--shadow-xl)', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem', color: 'var(--text-primary)', fontWeight: 800 }}>Add Element</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Select what type of element to place at this location</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                style={{ padding: '12px', borderRadius: '10px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: 'none', background: '#33658A', color: 'white', cursor: 'pointer' }}
                onClick={() => {
                  placeElement(placementChoiceCoords.lat, placementChoiceCoords.lng, 'gate');
                  setPlacementChoiceCoords(null);
                }}
              >
                <GitBranch size={18} /> Add Line
              </button>
              <button
                type="button"
                style={{ padding: '12px', borderRadius: '10px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: 'none', background: '#F26419', color: 'white', cursor: 'pointer' }}
                onClick={() => {
                  placeElement(placementChoiceCoords.lat, placementChoiceCoords.lng, 'buoy');
                  setPlacementChoiceCoords(null);
                }}
              >
                <CircleDot size={18} /> Add Buoy
              </button>
              <button
                type="button"
                style={{ padding: '10px', borderRadius: '10px', border: '1px solid #CBD5E1', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', marginTop: '4px' }}
                onClick={() => setPlacementChoiceCoords(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
