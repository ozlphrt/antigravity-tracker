import React, { useState, useEffect, useRef } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { Navigation, LocateFixed, Maximize, Plus, Minus, X, CircleDot, CornerUpLeft, CornerUpRight, Info } from 'lucide-react';
import { useGpsTracker } from '../../hooks/useGpsTracker';
import { supabase } from '../../database/mockSupabase';
import RaceLineMarker from '../RaceLineMarker';
import TapeCompass from './TapeCompass';
import InteractiveSeamarksLayer from '../InteractiveSeamarksLayer';
import { useFleetSim } from './useFleetSim';

// Dynamic rotated boat icon (top-down view)
const createRotatedBoatIcon = (heading, color = '#33658A') => {
  return new L.DivIcon({
    html: `<div style="transform: rotate(${heading}deg); width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.3));">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round" width="30" height="30">
        <path d="M12 2 L19 21 Q12 18 5 21 Z" />
      </svg>
    </div>`,
    className: 'boat-marker-icon-shell',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
};

const createAiBoatIcon = (heading, color) => {
  return new L.DivIcon({
    html: `<div style="transform: rotate(${heading}deg); width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 3px 5px rgba(0,0,0,0.35));">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round" width="24" height="24">
        <path d="M12 2 L19 21 Q12 18 5 21 Z" />
      </svg>
    </div>`,
    className: 'boat-marker-icon-shell',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

const finishBuoyIcon = new L.DivIcon({
  html: `<div style="background-color: var(--success-green); width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: var(--shadow-sm);"></div>`,
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

function MapInvalidator() {
  const map = useMap();
  useEffect(() => {
    // Force a resize check immediately and after a short delay
    // This fixes Leaflet gray/cutoff tile issues on mobile initialization
    map.invalidateSize();
    const timeoutId = setTimeout(() => {
      map.invalidateSize();
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [map]);
  return null;
}

const createStaticBuoyIcon = (rounding = 'port', id = '') => {
  const isPort = rounding.toLowerCase() === 'port';
  const color = 'var(--accent-coral)';
  const svgPath = isPort 
    ? `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>` 
    : `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`;
    
  return new L.DivIcon({
    html: `<div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75;">
        ${svgPath}
      </svg>
      <div style="position:absolute;background:white;color:var(--text-primary);border:2px solid ${color};border-radius:50%;font-weight:950;font-size:12px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;box-shadow:0 1.5px 4px rgba(0,0,0,0.35);">${id.replace(/\D/g, '')}</div>
    </div>`,
    className: 'buoy-marker-icon-shell',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

const createTargetBuoyIcon = (rounding, id = '') => {
  const isPort = rounding.toLowerCase() === 'port';
  const color = 'var(--accent-coral)';
  const svgPath = isPort 
    ? `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>` 
    : `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`;
    
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
      <div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
        <div class="${localClass}" style="position: absolute; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            ${svgPath}
          </svg>
        </div>
        <div style="position:absolute;background:white;color:var(--text-primary);border:2px solid ${color};border-radius:50%;font-weight:950;font-size:12px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;box-shadow:0 1.5px 4px rgba(0,0,0,0.35);">${id.replace(/\D/g, '')}</div>
      </div>`,
    className: 'buoy-marker-icon-shell',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
};

const getCheckpointKind = (checkpoint) => {
  if (checkpoint.kind) return checkpoint.kind;
  if (checkpoint.id === 'S' || checkpoint.id === 'start') return 'start';
  if (checkpoint.id === 'F' || checkpoint.id === 'finish') return 'finish';
  return checkpoint.type;
};

const isRaceTarget = (checkpoint) => {
  const kind = getCheckpointKind(checkpoint);
  return kind === 'start' || kind === 'buoy' || kind === 'gate' || kind === 'finish';
};

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

function MapCourseFitter({ course }) {
  const map = useMap();
  const lastFittedCourseIdRef = useRef(null);

  useEffect(() => {
    if (!course || !course.checkpoints || course.checkpoints.length === 0) return;
    if (lastFittedCourseIdRef.current === course.id) return;
    
    const isInitial = lastFittedCourseIdRef.current === null;
    lastFittedCourseIdRef.current = course.id;
    
    if (isInitial && window.__hasCenteredOnUser) {
      return;
    }
    
    const pts = course.checkpoints.flatMap(cp => {
      if (cp.coords) return cp.coords;
      if (cp.coord) return [cp.coord];
      return [];
    });
    
    if (pts.length > 0) {
      map.fitBounds(pts, { padding: [50, 50], animate: true });
    }
  }, [course, map]);

  return null;
}

function MapControls({ pos, autoCenter, setAutoCenter }) {
  const map = useMap();
  const lastCenterEnableTime = useRef(0);
  const lastPanTime = useRef(0);
  
  useEffect(() => {
    if (autoCenter && pos) {
      // Wait 1.2s before continuous panning to allow the initial flyTo animation to finish
      if (Date.now() - lastCenterEnableTime.current > 1200) {
        const center = map.getCenter();
        const dist = map.distance([pos.lat, pos.lng], center);
        const now = Date.now();
        // If the boat has moved more than 350m away from the center, smoothly pan to it
        if (dist > 350 && now - lastPanTime.current > 6000) {
          lastPanTime.current = now;
          map.panTo([pos.lat, pos.lng], { animate: true, duration: 2.5, easeLinearity: 0.15 });
        }
      }
    }
  }, [autoCenter, pos.lat, pos.lng, map]);

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
      top: '20px',
      right: '20px',
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
          // Perform an immediate center and zoom
          if (!autoCenter) {
            lastCenterEnableTime.current = Date.now();
            map.flyTo([pos.lat, pos.lng], 15.5, { duration: 1.2 });
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

function BuoyCircles({ targetPos }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  
  useMapEvents({
    zoom: () => {
      setZoom(map.getZoom());
    }
  });

  if (zoom < 13.5) return null;

  return (
    <>
      <Circle center={targetPos} radius={300} color="#33658A" fillOpacity={0} weight={1} opacity={0.3} />
      <Circle center={targetPos} radius={200} color="#33658A" fillOpacity={0} weight={1} opacity={0.4} />
      <Circle center={targetPos} radius={100} color="#33658A" fillOpacity={0} weight={1} opacity={0.5} />
      <Circle center={targetPos} radius={50} color="#F26419" fillOpacity={0.1} weight={1.5} opacity={0.8} />
    </>
  );
}

const ensureCheckpointsHaveCoords = (checkpoints) => {
  if (!checkpoints) return [];
  return checkpoints.map(cp => {
    const kind = cp.kind
      || (cp.id === 'start' || cp.id === 'S' ? 'start' : null)
      || (cp.id === 'finish' || cp.id === 'F' ? 'finish' : null)
      || cp.type;
      
    const normalizedCp = { ...cp, kind };

    if ((kind === 'start' || kind === 'finish' || kind === 'gate') && !normalizedCp.coords) {
      if (normalizedCp.coord) {
        const center = turf.point([normalizedCp.coord[1], normalizedCp.coord[0]]);
        const width = normalizedCp.width || 120;
        const rotation = normalizedCp.rotationDeg !== undefined ? normalizedCp.rotationDeg : 270;
        
        const angleA = (rotation + 90) % 360;
        const angleB = (rotation - 90 + 360) % 360;
        
        const halfDistKm = (width / 2) / 1000;
        
        const ptA = turf.destination(center, halfDistKm, angleA, { units: 'kilometers' });
        const ptB = turf.destination(center, halfDistKm, angleB, { units: 'kilometers' });
        
        const coordA = [ptA.geometry.coordinates[1], ptA.geometry.coordinates[0]];
        const coordB = [ptB.geometry.coordinates[1], ptB.geometry.coordinates[0]];
        
        normalizedCp.coords = [coordA, coordB];
      } else {
        normalizedCp.coords = [
          [36.9758, 27.4595],
          [36.9758, 27.4605]
        ];
      }
    }
    return normalizedCp;
  });
};

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
        refCp = ordered.slice(i + 1).find(c => c.id !== cp.id);
      }

      if (refCp) {
        const cpMid = [
          (cp.coords[0][0] + cp.coords[1][0]) / 2,
          (cp.coords[0][1] + cp.coords[1][1]) / 2,
        ];
        let refCoord = refCp.coord;
        if (!refCoord && refCp.coords) {
          refCoord = [
            (refCp.coords[0][0] + refCp.coords[1][0]) / 2,
            (refCp.coords[0][1] + refCp.coords[1][1]) / 2,
          ];
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

const normalizeCourse = (courseObj) => {
  if (!courseObj) return null;
  const withCoords = ensureCheckpointsHaveCoords(courseObj.checkpoints);
  return {
    ...courseObj,
    checkpoints: enforceCourseOrder(withCoords)
  };
};

export default function BoatPwaMain({ courseOverride, onStatusChange, showDots = true }) {
  const [isLiveMode, setIsLiveMode] = useState(true);

  // Callback for live GPS trace — runs inside useGpsTracker on each captured fix
  const liveTrackCallback = React.useCallback((point) => {
    setTrace(t => [...t, point]);
  }, []);

  const { position, isOnline, offlineQueueSize } = useGpsTracker('boat-1', isLiveMode, liveTrackCallback);
  const [course, setCourse] = useState(null);
  const [simulatedPos, setSimulatedPos] = useState(() => {
    const saved = localStorage.getItem('simulated_boat_pos');
    const pos = saved ? JSON.parse(saved) : { lat: 36.9758, lng: 27.4601 };
    return { ...pos, heading: 180, targetHeading: 180, speed: 6.0, timeMultiplier: 20 };
  });

  // Auto-place the simulated boat behind the start line if no saved position, or if saved position is >1.5 km away
  useEffect(() => {
    if (!course) return;
    const isRaceTarget = (cp) => cp.kind === 'start' || cp.kind === 'buoy' || cp.kind === 'gate' || cp.kind === 'finish';
    const targets = course.checkpoints.filter(isRaceTarget);
    const startIdx = targets.findIndex(cp => cp.kind === 'start');
    if (startIdx !== -1) {
      const startLine = targets[startIdx];
      const sLat = (startLine.coords[0][0] + startLine.coords[1][0]) / 2;
      const sLng = (startLine.coords[0][1] + startLine.coords[1][1]) / 2;
      const startPt = turf.point([sLng, sLat]);

      const saved = localStorage.getItem('simulated_boat_pos');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const distToStart = turf.distance(turf.point([parsed.lng, parsed.lat]), startPt, { units: 'kilometers' });
          if (distToStart < 1.5) {
            // Keep saved position if close to the start line
            return;
          }
        } catch (e) {
          // Parse error, reset position
        }
      }

      let courseBearing = 0;
      const nextMark = targets[startIdx + 1];
      if (nextMark) {
        let nLat, nLng;
        if (nextMark.kind === 'buoy' && nextMark.coord) {
          nLat = nextMark.coord[0]; nLng = nextMark.coord[1];
        } else if (nextMark.coords) {
          nLat = (nextMark.coords[0][0] + nextMark.coords[1][0]) / 2;
          nLng = (nextMark.coords[0][1] + nextMark.coords[1][1]) / 2;
        }
        if (nLat !== undefined && nLng !== undefined) {
          courseBearing = turf.bearing(startPt, turf.point([nLng, nLat]));
        }
      }
      const reverseBearing = (courseBearing + 180) % 360;
      const spawnPt = turf.destination(startPt, 0.4, reverseBearing, { units: 'kilometers' }); // 400 m behind start line
      const [spawnLng, spawnLat] = spawnPt.geometry.coordinates;
      const initialHdg = (courseBearing + 360) % 360;
      const newPos = { lat: spawnLat, lng: spawnLng, heading: initialHdg, targetHeading: initialHdg, speed: 6.0, timeMultiplier: 20 };
      setSimulatedPos(newPos);
      localStorage.setItem('simulated_boat_pos', JSON.stringify(newPos));
    }
  }, [course]);
  const [trace, setTrace] = useState([]);
  const [autoCenter, setAutoCenter] = useState(true);
  const [activeTargetIndex, setActiveTargetIndex] = useState(0);

  // Auto steer
  const [isAutoSteer, setIsAutoSteer] = useState(true);
  const autoSteerOverrideUntil = useRef(0); // timestamp until which override is active
  const autoSteerPhase = useRef('race'); // 'approach' | 'race'
  const upwindWaypointRef = useRef(null);  // computed once per auto-steer activation

  // Telemetry & Offline State
  const [isSimOnline, setIsSimOnline] = useState(true);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [syncingQueue, setSyncingQueue] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState(Date.now());
  const lastCapturedPos = useRef(null);
  
  const activePos = isLiveMode && position ? position : simulatedPos;

  // Fleet simulation (9 AI boats — FYI only, does not affect user's HUD)
  const { boats: aiBoats, trails: aiTrails } = useFleetSim(course, !isLiveMode, activePos?.timeMultiplier || 20);

  const [hasFinished, setHasFinished] = useState(false);
  const [isRaceFinishedModalOpen, setIsRaceFinishedModalOpen] = useState(false);
  const [hasDownloadedRoute, setHasDownloadedRoute] = useState(false);
  const [isAttributionModalOpen, setIsAttributionModalOpen] = useState(false);

  useEffect(() => {
    if (!onStatusChange) return;
    onStatusChange({
      state: isSyncing ? 'syncing' : (isSimOnline ? 'online' : 'buffering'),
      queueSize: offlineQueue.length + syncingQueue.length,
      pointsRecorded: trace.length,
      lastSynced: lastSyncedTime,
      resolution: isLiveMode && position && position.accuracy ? `± ${(position.accuracy).toFixed(1)}m` : '± 4.2m (Sim)',
      collectionStatus: 'Active'
    });
  }, [isSimOnline, isSyncing, offlineQueue.length, syncingQueue.length, trace.length, lastSyncedTime, isLiveMode, position, onStatusChange]);

  useEffect(() => {
    setTrace([]);
    setActiveTargetIndex(0);
    minDistanceRef.current = Infinity;
    closestSideRef.current = null;
    lastCapturedPos.current = null;
    lastPosRef.current = null;
    setIsAutoSteer(!isLiveMode);
    autoSteerPhase.current = 'race';
    upwindWaypointRef.current = null;
    hasPassedEntranceRef.current = false;
  }, [isLiveMode]);

  // ── Auto Steer ─────────────────────────────────────────────────────────────
  // Runs only in Sim mode. On each tick computes the desired heading:
  //   Phase 1 "approach": navigate to a waypoint 300 m upwind of the start line midpoint.
  //   Phase 2 "race":     navigate straight to the active target midpoint.
  useEffect(() => {
    if (!isAutoSteer || isLiveMode || !course) return;

    const targets = course.checkpoints.filter(isRaceTarget);
    if (targets.length === 0) return;

    // Build upwind waypoint from start line on first activation
    if (!upwindWaypointRef.current) {
      const startCp = course.checkpoints.find(cp => {
        const k = cp.kind || cp.type;
        return k === 'start';
      });
      if (startCp && startCp.coords) {
        const mid = turf.point([
          (startCp.coords[0][1] + startCp.coords[1][1]) / 2,
          (startCp.coords[0][0] + startCp.coords[1][0]) / 2,
        ]);
        // 300 m upwind (bearing 0 = north = "upwind" assumed; adjust if course has wind direction)
        const upwind = turf.destination(mid, 0.3, 0, { units: 'kilometers' });
        upwindWaypointRef.current = {
          lat: upwind.geometry.coordinates[1],
          lng: upwind.geometry.coordinates[0],
        };
      } else {
        // No start line — skip approach phase
        autoSteerPhase.current = 'race';
        upwindWaypointRef.current = { lat: 0, lng: 0 }; // sentinel
      }
    }

    const interval = setInterval(() => {
      setSimulatedPos(prev => {
        if (Date.now() < autoSteerOverrideUntil.current) return prev; // manual override active

        let desiredBearing;

        if (autoSteerPhase.current === 'approach' && upwindWaypointRef.current) {
          const wp = upwindWaypointRef.current;
          const boatPt = turf.point([prev.lng, prev.lat]);
          const wpPt = turf.point([wp.lng, wp.lat]);
          const distKm = turf.distance(boatPt, wpPt, { units: 'kilometers' });
          desiredBearing = turf.bearing(boatPt, wpPt);

          // Transition to race phase once within 50 m of the upwind waypoint
          if (distKm < 0.05) {
            autoSteerPhase.current = 'race';
          }
        } else {
          // Race phase: aim at current target
          const target = targets[activeTargetIndex];
          if (!target) return prev; // finished

          let tLat, tLng;
          const kind = target.kind || target.type;
          if (kind === 'buoy') {
            tLat = target.coord[0]; tLng = target.coord[1];
          } else {
            tLat = (target.coords[0][0] + target.coords[1][0]) / 2;
            tLng = (target.coords[0][1] + target.coords[1][1]) / 2;
          }
          const boatPt = turf.point([prev.lng, prev.lat]);
          const tPt = turf.point([tLng, tLat]);

          if (kind === 'buoy') {
             // Calculate a FIXED approach bearing to determine the offset target
             let approachBearing = 0;
             const prevTarget = targets[activeTargetIndex - 1];
             if (prevTarget) {
                 let ptLat, ptLng;
                 if (prevTarget.kind === 'buoy' && prevTarget.coord) { 
                     ptLat = prevTarget.coord[0]; ptLng = prevTarget.coord[1]; 
                 } else if (prevTarget.coords) { 
                     ptLat = (prevTarget.coords[0][0] + prevTarget.coords[1][0])/2; 
                     ptLng = (prevTarget.coords[0][1] + prevTarget.coords[1][1])/2; 
                 }
                 if (ptLat !== undefined && ptLng !== undefined) {
                     approachBearing = turf.bearing(turf.point([ptLng, ptLat]), tPt);
                 }
             } else {
                 approachBearing = upwindWaypointRef.current ? turf.bearing(turf.point([upwindWaypointRef.current.lng, upwindWaypointRef.current.lat]), tPt) : 0;
             }

             let exitBearing = approachBearing;
             const nextTarget = targets[activeTargetIndex + 1];
             if (nextTarget) {
                 let ntLat, ntLng;
                 if (nextTarget.kind === 'buoy' && nextTarget.coord) {
                     ntLat = nextTarget.coord[0]; ntLng = nextTarget.coord[1];
                 } else if (nextTarget.coords) {
                     ntLat = (nextTarget.coords[0][0] + nextTarget.coords[1][0])/2;
                     ntLng = (nextTarget.coords[0][1] + nextTarget.coords[1][1])/2;
                 }
                 if (ntLat !== undefined && ntLng !== undefined) {
                     exitBearing = turf.bearing(tPt, turf.point([ntLng, ntLat]));
                 }
             }

             const isPort = (target.rounding || 'port').toLowerCase() === 'port';
             const offsetBearing = hasPassedEntranceRef.current
                 ? (exitBearing + (isPort ? 90 : -90))
                 : (approachBearing + (isPort ? 90 : -90));

             // 25m offset to ensure we clear the buoy nicely
             const offsetTarget = turf.destination(tPt, 0.025, offsetBearing, { units: 'kilometers' });
             
             // Steer towards this FIXED offset target
             desiredBearing = turf.bearing(boatPt, offsetTarget);
          } else {
             const dist = turf.distance(boatPt, tPt, { units: 'kilometers' });
             if (dist <= 0.12) {
                const ptA = turf.point([target.coords[0][1], target.coords[0][0]]);
                const ptB = turf.point([target.coords[1][1], target.coords[1][0]]);
                const crossingSide = target.crossing || 'up';
                let arrowBearing = 0;
                if (crossingSide === 'center') {
                  arrowBearing = target.rotationDeg || 0;
                } else {
                   const lineBearing = turf.bearing(ptA, ptB);
                   arrowBearing = (lineBearing + (crossingSide === 'up' ? -90 : 90) + 360) % 360;
                }
                desiredBearing = arrowBearing;
             } else {
                desiredBearing = turf.bearing(boatPt, tPt);
             }
          }
        }

        // Normalise bearing to 0-360
        const normBearing = (desiredBearing + 360) % 360;
        return { ...prev, targetHeading: normBearing };
      });
    }, 100); // check 10x/sec

    return () => clearInterval(interval);
  }, [isAutoSteer, isLiveMode, course, activeTargetIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (courseOverride) {
      setCourse(normalizeCourse(courseOverride));
      setActiveTargetIndex(0);
      minDistanceRef.current = Infinity;
      return;
    }

    supabase.getCourses().then(courses => {
      if (courses && courses.length > 0) {
        const activeId = localStorage.getItem('rc_active_course_id');
        const activeCourse = courses.find(c => c.id === activeId)
          || courses.find(c => c.name === 'Bodrum Bay Demo')
          || courses.find(c => c.name === 'ABC')
          || courses.find(c => c.name === 'Karaada Course')
          || courses.find(c => c.name && c.name.toLowerCase().includes('karaada'))
          || courses.find(c => c.id === 'course-1')
          || courses[0];
        setCourse(normalizeCourse(activeCourse));
      }
    });
  }, [courseOverride]);

  // Auto-place Sim Boat 300m behind start line
  useEffect(() => {
    if (course && course.checkpoints) {
      const isRaceTarget = (cp) => cp.kind === 'start' || cp.kind === 'finish' || cp.kind === 'gate' || cp.kind === 'buoy';
      const targets = course.checkpoints.filter(isRaceTarget);
      const startIdx = targets.findIndex(cp => cp.kind === 'start');
      
      if (startIdx !== -1) {
        const startLine = targets[startIdx];
        const sLat = (startLine.coords[0][0] + startLine.coords[1][0]) / 2;
        const sLng = (startLine.coords[0][1] + startLine.coords[1][1]) / 2;
        const startPt = turf.point([sLng, sLat]);
        
        const ptA = turf.point([startLine.coords[0][1], startLine.coords[0][0]]);
        const ptB = turf.point([startLine.coords[1][1], startLine.coords[1][0]]);
        
        const crossingSide = startLine.crossing || 'up';
        let arrowBearing = 0;
        if (crossingSide === 'center') {
          arrowBearing = startLine.rotationDeg || 0;
        } else {
          const lineBearing = turf.bearing(ptA, ptB);
          arrowBearing = (lineBearing + (crossingSide === 'up' ? -90 : 90) + 360) % 360;
        }
        
        const reverseBearing = (arrowBearing + 180) % 360;
        const spawnPt = turf.destination(startPt, 0.3, reverseBearing, { units: 'kilometers' });
        const [spawnLng, spawnLat] = spawnPt.geometry.coordinates;
        
        setSimulatedPos(prev => ({
          ...prev,
          lat: spawnLat,
          lng: spawnLng,
          heading: (arrowBearing + 360) % 360,
          targetHeading: (arrowBearing + 360) % 360
        }));
      }
    }
  }, [course]);

  // Simple GPS simulator
  useEffect(() => {
    let interval;
    if (!isLiveMode) {
      interval = setInterval(() => {
        setSimulatedPos(prev => {
          let currentHdg = prev.heading;
          let targetHdg = prev.targetHeading !== undefined ? prev.targetHeading : currentHdg;
          
          if (targetHdg !== currentHdg) {
            let diff = targetHdg - currentHdg;
            while (diff <= -180) diff += 360;
            while (diff > 180) diff -= 360;
            
            if (Math.abs(diff) <= 0.5) {
              currentHdg = targetHdg;
            } else {
              // 20 FPS Ease-out interpolation
              let turnSpeed = Math.abs(diff) * 0.1;
              turnSpeed = Math.min(Math.max(turnSpeed, 0.2), 2.0); // max 40 deg/sec
              currentHdg += Math.sign(diff) * turnSpeed;
              currentHdg = (currentHdg + 360) % 360;
            }
          }

          const hdgRad = currentHdg * (Math.PI / 180);
          const currentMultiplier = prev.timeMultiplier || 1;
          const distance = (prev.speed * currentMultiplier * 0.514444) * 0.05; // distance in 50ms real time
          const deltaLat = (distance / 111111) * Math.cos(hdgRad);
          const deltaLng = (distance / (111111 * Math.cos(prev.lat * (Math.PI / 180)))) * Math.sin(hdgRad);
          
          const newPos = { 
            ...prev,
            heading: currentHdg,
            targetHeading: targetHdg,
            lat: prev.lat + deltaLat,
            lng: prev.lng + deltaLng,
            timestamp: Date.now()
          };
          
          // --- SMART GPS LOGGING ALGORITHM ---
          if (!lastCapturedPos.current) {
            lastCapturedPos.current = newPos;
            setTrace(t => [...t, newPos]);
          } else {
            const now = Date.now();
            const timeSinceLast = now - lastCapturedPos.current.timestamp;
            let hdgDiff = Math.abs(currentHdg - lastCapturedPos.current.heading);
            if (hdgDiff > 180) hdgDiff = 360 - hdgDiff;
            
            const isNearTarget = minDistanceRef.current < 0.5; // Within 500m of a buoy
            let shouldCapture = false;
            
            // 1. Maneuvering: Turn > 3 degrees
            if (hdgDiff >= 3.0) shouldCapture = true;
            // 2. Proximity: Within 500m -> 2s interval
            else if (isNearTarget && timeSinceLast >= 2000) shouldCapture = true;
            // 3. Heartbeat: Straight line -> 10s interval
            else if (timeSinceLast >= 10000) shouldCapture = true;
            
            if (shouldCapture) {
              lastCapturedPos.current = newPos;
              
              // We define several dead zones to simulate losing cellular coverage frequently
              const inDeadZone1 = newPos.lng > 27.421 && newPos.lng < 27.426;
              const inDeadZone2 = newPos.lng > 27.433 && newPos.lng < 27.439;
              const inDeadZone3 = newPos.lng > 27.412 && newPos.lng < 27.416; // West dead zone
              const inDeadZone4 = newPos.lng > 27.442 && newPos.lng < 27.446; // East dead zone
              const inDeadZone5 = newPos.lat > 37.015 && newPos.lat < 37.017 && newPos.lng > 27.426 && newPos.lng < 27.433; // Center cross block
              const currentlyOnline = !(inDeadZone1 || inDeadZone2 || inDeadZone3 || inDeadZone4 || inDeadZone5);
              
              if (currentlyOnline) {
                 setIsSimOnline(true);
                 setOfflineQueue(q => {
                   if (q.length > 0) {
                     // Connection restored! Flush queue.
                     setIsSyncing(true);
                     const pointsToSync = [...q, newPos];
                     setSyncingQueue(pointsToSync);
                     setTimeout(() => {
                       setTrace(t => [...t, ...pointsToSync].sort((a, b) => a.timestamp - b.timestamp));
                       setSyncingQueue([]);
                       setIsSyncing(false);
                     }, 2000); // Show syncing UI for 2s
                     setLastSyncedTime(Date.now());
                     return [];
                   } else {
                     setTrace(t => [...t, newPos]);
                     setLastSyncedTime(Date.now());
                     return q;
                   }
                 });
              } else {
                 // Offline! Buffer to queue.
                 setIsSimOnline(false);
                 setOfflineQueue(q => [...q, newPos]);
              }
            }
          }
          
          return newPos;
        });
      }, 50);
    }
    return () => clearInterval(interval);
  }, [isLiveMode]);

  // Sync simulator to tracker (mocking the real navigator.geolocation for local demo)
  useEffect(() => {
    if (!isLiveMode && navigator.geolocation.mock) {
       // if we were strictly intercepting. Instead we'll just display simulatedPos directly 
       // but in a real PWA this uses useGpsTracker position
    }
  }, [simulatedPos, isLiveMode]);

  const minDistanceRef = useRef(Infinity);
  const closestSideRef = useRef(null);
  const lastPosRef = useRef(null);
  const hasPassedEntranceRef = useRef(false);

  // Auto-advance to next buoy using Closest Point of Approach (CPA)
  useEffect(() => {
    if (!course || !activePos) return;
    const targets = course.checkpoints.filter(isRaceTarget);
    const target = targets[activeTargetIndex];
    if (target) {
      const isLine = getCheckpointKind(target) !== 'buoy';
      let tLat, tLng;
      if (!isLine) {
        tLat = target.coord[0];
        tLng = target.coord[1];
      } else {
        tLat = (target.coords[0][0] + target.coords[1][0]) / 2;
        tLng = (target.coords[0][1] + target.coords[1][1]) / 2;
      }
      
      const pt1 = turf.point([activePos.lng, activePos.lat]);
      const pt2 = turf.point([tLng, tLat]);
      const distance = turf.distance(pt1, pt2, { units: 'kilometers' });
      
      const absoluteBearing = turf.bearing(pt1, pt2);
      let relativeBearing = absoluteBearing - activePos.heading;
      while (relativeBearing <= -180) relativeBearing += 360;
      while (relativeBearing > 180) relativeBearing -= 360;

      if (distance < minDistanceRef.current) {
        minDistanceRef.current = distance;
        closestSideRef.current = relativeBearing < 0 ? 'port' : 'starboard';
      }
      
      if (isLine) {
        // For lines (start, finish, gates), we strictly check if the boat path intersected the line segment
        let lineCrossed = false;
        if (lastPosRef.current && (lastPosRef.current.lat !== activePos.lat || lastPosRef.current.lng !== activePos.lng)) {
          const boatPath = turf.lineString([
            [lastPosRef.current.lng, lastPosRef.current.lat],
            [activePos.lng, activePos.lat]
          ]);
          const targetLine = turf.lineString([
            [target.coords[0][1], target.coords[0][0]],
            [target.coords[1][1], target.coords[1][0]]
          ]);
          const intersects = turf.lineIntersect(boatPath, targetLine);
          if (intersects.features.length > 0) {
            lineCrossed = true;
          }
        }
        
        if (lineCrossed && activeTargetIndex < targets.length) {
          setActiveTargetIndex(prev => prev + 1);
          minDistanceRef.current = Infinity; // Reset for next target
          closestSideRef.current = null;
          if (activeTargetIndex === 0) {
            autoSteerPhase.current = 'race';
          }
        }
      } else {
        // Find reference coordinates
        const prevTarget = targets[activeTargetIndex - 1];
        const nextTarget = targets[activeTargetIndex + 1];
        
        let prevCoord = prevTarget ? prevTarget.coord : null;
        if (!prevCoord && prevTarget && prevTarget.coords) {
          prevCoord = [
            (prevTarget.coords[0][0] + prevTarget.coords[1][0]) / 2,
            (prevTarget.coords[0][1] + prevTarget.coords[1][1]) / 2
          ];
        }
        if (!prevCoord) {
          prevCoord = upwindWaypointRef.current ? [upwindWaypointRef.current.lat, upwindWaypointRef.current.lng] : [activePos.lat, activePos.lng];
        }

        let nextCoord = nextTarget ? nextTarget.coord : null;
        if (!nextCoord && nextTarget && nextTarget.coords) {
          nextCoord = [
            (nextTarget.coords[0][0] + nextTarget.coords[1][0]) / 2,
            (nextTarget.coords[0][1] + nextTarget.coords[1][1]) / 2
          ];
        }
        if (!nextCoord) {
          nextCoord = [target.coord[0], target.coord[1]]; // fallback
        }

        const vX = target.coord[1] - prevCoord[1];
        const vY = target.coord[0] - prevCoord[0];
        const uX = nextCoord[1] - target.coord[1];
        const uY = nextCoord[0] - target.coord[0];
        const wX = activePos.lng - target.coord[1];
        const wY = activePos.lat - target.coord[0];

        const dotIn = vX * wX + vY * wY;
        const dotOut = uX * wX + uY * wY;

        // Check entrance
        if (!hasPassedEntranceRef.current) {
          const entrancePassed = dotIn > 0 && distance < 0.15;
          const isSharpTurn = (vX * uX + vY * uY) < 0;
          const isFarSideCorrect = !isSharpTurn || (dotOut < 0);

          if (entrancePassed && isFarSideCorrect) {
            const crossIn = vX * wY - vY * wX;
            const rounding = (target.rounding || 'port').toLowerCase();
            const sideCorrect = rounding === 'port' ? (crossIn < 0) : (crossIn > 0);
            if (sideCorrect) {
              hasPassedEntranceRef.current = true;
            }
          }
        }

        // Check exit / completion
        if (hasPassedEntranceRef.current && dotOut > 0) {
          setActiveTargetIndex(prev => prev + 1);
          minDistanceRef.current = Infinity;
          closestSideRef.current = null;
          hasPassedEntranceRef.current = false;
        } else if (distance > minDistanceRef.current + 0.1 && minDistanceRef.current < 0.4 && !hasPassedEntranceRef.current) {
          // If we passed the buoy (distance is increasing) but failed entrance check (wrong side),
          // reset minDistance so we can circle back and try again
          minDistanceRef.current = Infinity;
          closestSideRef.current = null;
        }
      }
    }
    lastPosRef.current = { lat: activePos.lat, lng: activePos.lng };
  }, [activePos, course, activeTargetIndex]);

  // Calculate relative bearing to the next target
  let relativeAngle = 0;
  let targetBearing = null;
  let targetName = 'None';
  let targetRounding = '';
  let targetPos = null;
  let targetDistanceStr = '';
  
  if (course && activePos) {
    const targets = course.checkpoints.filter(isRaceTarget);
    const target = targets[activeTargetIndex];
    if (target) {
      targetName = target.id.toUpperCase();
      targetRounding = target.rounding ? target.rounding.toUpperCase() : 'LINE';
      
      let tLat, tLng;
      if (getCheckpointKind(target) === 'buoy') {
        tLat = target.coord[0];
        tLng = target.coord[1];
      } else {
        tLat = (target.coords[0][0] + target.coords[1][0]) / 2;
        tLng = (target.coords[0][1] + target.coords[1][1]) / 2;
      }
      
      targetPos = [tLat, tLng]; // Leaflet uses [lat, lng]
      const pt1 = turf.point([activePos.lng, activePos.lat]);
      const pt2 = turf.point([tLng, tLat]);
      const absoluteBearing = turf.bearing(pt1, pt2);
      targetBearing = (absoluteBearing + 360) % 360;
      
      relativeAngle = absoluteBearing - activePos.heading;
      while (relativeAngle <= -180) relativeAngle += 360;
      while (relativeAngle > 180) relativeAngle -= 360;

      const distanceKm = turf.distance(pt1, pt2, { units: 'kilometers' });
      const distanceNM = distanceKm * 0.539957;
      if (distanceNM >= 0.1) {
        targetDistanceStr = `${distanceNM.toFixed(2)} NM`;
      } else {
        targetDistanceStr = `${Math.round(distanceKm * 1000)} m`;
      }
    } else {
      targetName = 'FINISHED';
    }
  }

  // Handle Race Finish
  useEffect(() => {
    if (course && activePos) {
      const targets = course.checkpoints.filter(isRaceTarget);
      if (activeTargetIndex >= targets.length && targets.length > 0) {
        if (!hasFinished) setHasFinished(true);
      }
    }
  }, [activeTargetIndex, course, activePos, hasFinished]);

  useEffect(() => {
    if (hasFinished && !hasDownloadedRoute && offlineQueue.length === 0 && syncingQueue.length === 0) {
      setHasDownloadedRoute(true);
      
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(trace, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      
      // format date and time e.g., 2026-05-22_19-30-00
      const date = new Date();
      const filenameStr = date.getFullYear() + "-" + 
                          String(date.getMonth() + 1).padStart(2, '0') + "-" + 
                          String(date.getDate()).padStart(2, '0') + "_" + 
                          String(date.getHours()).padStart(2, '0') + "-" + 
                          String(date.getMinutes()).padStart(2, '0') + "-" + 
                          String(date.getSeconds()).padStart(2, '0');
                          
      downloadAnchorNode.setAttribute("download", `bayk_route_${filenameStr}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      
      setIsRaceFinishedModalOpen(true);
    }
  }, [hasFinished, hasDownloadedRoute, offlineQueue.length, syncingQueue.length, trace]);

  return (
    <div className="map-container">
      <MapContainer center={[37.015, 27.420]} zoom={15.5} zoomSnap={0.1} maxZoom={22} zoomControl={false} attributionControl={false} preferCanvas={true} style={{ width: '100%', height: '100%', background: '#0b0f19' }}>
        <MapInitialLocationCenterer />
        <MapCourseFitter course={course} />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={22}
          maxNativeZoom={19}
        />
        <InteractiveSeamarksLayer />
        <MapInvalidator />
        <MapControls pos={activePos} autoCenter={autoCenter} setAutoCenter={setAutoCenter} />
        <Polyline positions={trace.map(p => [p.lat, p.lng])} color="#33658A" weight={3} opacity={0.6} />
        {showDots && trace.map((p, idx) => (
          <CircleMarker key={`trace-${idx}`} center={[p.lat, p.lng]} radius={3} color="#33658A" fillColor="#33658A" fillOpacity={1} stroke={false} />
        ))}
        
        {syncingQueue.length > 0 && (
          <React.Fragment>
            <Polyline 
              positions={(trace.length > 0 ? [trace[trace.length - 1], ...syncingQueue] : syncingQueue).map(p => [p.lat, p.lng])} 
              color="#EAB308" weight={3} opacity={0.8} 
            />
            {showDots && syncingQueue.map((p, idx) => (
              <CircleMarker key={`sync-${idx}`} center={[p.lat, p.lng]} radius={3} color="#EAB308" fillColor="#EAB308" fillOpacity={1} stroke={false} />
            ))}
          </React.Fragment>
        )}
        
        {offlineQueue.length > 0 && (
          <React.Fragment>
            <Polyline 
              positions={(syncingQueue.length > 0 ? [syncingQueue[syncingQueue.length - 1], ...offlineQueue] : (trace.length > 0 ? [trace[trace.length - 1], ...offlineQueue] : offlineQueue)).map(p => [p.lat, p.lng])} 
              color="#EF4444" weight={3} opacity={0.8} 
            />
            {showDots && offlineQueue.map((p, idx) => (
              <CircleMarker key={`off-${idx}`} center={[p.lat, p.lng]} radius={3} color="#EF4444" fillColor="#EF4444" fillOpacity={1} stroke={false} />
            ))}
          </React.Fragment>
        )}
        
        {/* Bearing Line to Active Target */}
        {activePos && targetPos && targetName !== 'FINISHED' && (
          <Polyline 
            positions={[[activePos.lat, activePos.lng], targetPos]} 
            color="#F26419" 
            weight={3} 
            dashArray="0, 10"
            lineCap="round" 
            opacity={0.6} 
          />
        )}
        
        {/* AI fleet — always visible in sim mode */}
        {(() => {
          return aiBoats.map((boat, idx) => {
            const trail = aiTrails[boat.id] || [];
            
            return (
              <React.Fragment key={boat.id}>
                {trail.length > 1 && (
                  <Polyline
                    positions={trail.map(p => [p.lat, p.lng])}
                    color={boat.color}
                    weight={2}
                    opacity={0.45}
                  />
                )}
                <Marker
                  position={[boat.lat, boat.lng]}
                  icon={createAiBoatIcon(boat.heading, boat.color)}
                  interactive={true}
                  zIndexOffset={1000}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                    <span style={{ fontWeight: 700, fontSize: '11px', color: boat.color }}>{boat.name}</span>
                  </Tooltip>
                </Marker>
              </React.Fragment>
            );
          });
        })()}

        {/* Boat Heading Line & Marker */}
        {activePos && (() => {
          const pt = turf.point([activePos.lng, activePos.lat]);
          // Draw a 1 km heading line (lengthened from 150m)
          const dest = turf.destination(pt, 1.0, activePos.heading, { units: 'kilometers' }).geometry.coordinates;
          const lineCoords = [
            [activePos.lat, activePos.lng],
            [dest[1], dest[0]]
          ];
          return (
            <React.Fragment>
              <Polyline positions={lineCoords} color="#33658A" weight={2} dashArray="5, 5" opacity={0.8} />
              <CircleMarker 
                center={[activePos.lat, activePos.lng]} 
                radius={22} 
                color="var(--accent-coral)" 
                fillColor="var(--accent-coral)" 
                fillOpacity={0.12} 
                weight={2.5} 
                dashArray="4, 5" 
                interactive={false} 
              />
              <CircleMarker 
                center={[activePos.lat, activePos.lng]} 
                radius={3} 
                color="var(--accent-coral)" 
                fillColor="var(--accent-coral)" 
                fillOpacity={1} 
                stroke={false} 
                interactive={false} 
              />
              <Marker
          position={[activePos.lat, activePos.lng]}
          icon={createRotatedBoatIcon(activePos.heading)}
          draggable={true}
          zIndexOffset={1000}
          eventHandlers={{
            dragend: (e) => {
              const { lat, lng } = e.target.getLatLng();
              const newPos = { ...activePos, lat, lng };
              setSimulatedPos(newPos);
              localStorage.setItem('simulated_boat_pos', JSON.stringify(newPos));
            },
          }}
        />
            </React.Fragment>
          );
        })()}
        
        {targetPos && targetRounding !== 'LINE' && targetName !== 'FINISHED' && (
          <BuoyCircles targetPos={targetPos} />
        )}
        
        {course && course.checkpoints.map((cp, idx) => {
          const kind = getCheckpointKind(cp);
          const isTarget = cp.id.toUpperCase() === targetName;
          if (kind === 'buoy') {
             let iconToUse = createStaticBuoyIcon(cp.rounding || 'port', cp.id);
             if (isTarget) {
               iconToUse = createTargetBuoyIcon(cp.rounding || 'port', cp.id);
             }
             return <Marker key={idx} position={[cp.coord[0], cp.coord[1]]} icon={iconToUse} opacity={isTarget ? 1 : 0.6} zIndexOffset={-500} />;
          } else if (kind === 'gate' || kind === 'start' || kind === 'finish') {
             const lineKind = kind === 'finish' ? 'finish' : kind === 'start' ? 'start' : 'gate';
             return (
               <RaceLineMarker
                 key={idx}
                 coords={cp.coords}
                 kind={lineKind}
                 crossing={cp.crossing}
                 opacity={isTarget ? 1 : 0.4}
                 zIndexOffset={-500}
               />
             );
          }
          return null;
        })}
      </MapContainer>

      <div style={{ position: 'absolute', bottom: 'max(15px, env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', width: '90%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 999 }}>
        <div className="simulator-panel" style={{ padding: '0 8px', background: 'transparent', boxShadow: 'none', border: 'none', position: 'relative', bottom: 'auto', right: 'auto', width: '100%', display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', borderRadius: '24px', padding: '4px', border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
            <button 
              type="button"
              onClick={() => setIsLiveMode(false)}
              style={{ flex: 1, padding: '6px 14px', borderRadius: '20px', border: 'none', background: !isLiveMode ? 'var(--accent-blue)' : 'transparent', color: !isLiveMode ? 'white' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s ease', whiteSpace: 'nowrap' }}>
              Sim
            </button>
            <button 
              type="button"
              onClick={() => setIsLiveMode(true)}
              style={{ flex: 1, padding: '6px 14px', borderRadius: '20px', border: 'none', background: isLiveMode ? 'var(--accent-coral)' : 'transparent', color: isLiveMode ? 'white' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s ease', whiteSpace: 'nowrap' }}>
              Live
            </button>
          </div>

        
        </div>

        <div className="helm-dashboard glass-panel" style={{ position: 'relative', bottom: 'auto', left: 'auto', transform: 'none', width: '100%', display: 'flex', flexDirection: 'column', gap: '8px', margin: 0 }}>
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              HEADING
              <button type="button" onClick={() => setIsAttributionModalOpen(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }} title="Map Info">
                <Info size={14} />
              </button>
            </span>
            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--accent-coral)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {targetDistanceStr && (
                <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.75rem', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {targetDistanceStr}
                </span>
              )}
              <span style={{ display: 'flex', alignItems: 'center' }}>
                <CircleDot size={14} strokeWidth={3} style={{ marginRight: '4px' }} /> {targetName}
              </span>
              {targetRounding === 'PORT' && <CornerUpLeft size={16} strokeWidth={3} style={{ marginLeft: '4px' }} title="Port Rounding" />}
              {targetRounding === 'STARBOARD' && <CornerUpRight size={16} strokeWidth={3} style={{ marginLeft: '4px' }} title="Starboard Rounding" />}
            </span>
          </div>
          <TapeCompass heading={activePos.heading} targetBearing={targetBearing} />
        </div>
        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <div className="metric-box" style={{ flex: 1 }}>
            <div className="label">SOG (Kts)</div>
            <div className="value">{activePos.speed.toFixed(1)}</div>
          </div>
          <div className="metric-box" style={{ flex: 1 }}>
            <div className="label">BRG (&deg;)</div>
            <div className="value">{targetBearing !== null ? Math.round(targetBearing) : '-'}</div>
          </div>
          <div className="metric-box" style={{ flex: 1 }}>
            <div className="label">COG (&deg;)</div>
            <div className="value">{activePos.heading.toFixed(0)}</div>
          </div>
        </div>
      </div>
    </div>
    {isRaceFinishedModalOpen && (
  <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
    <div className="modal-content" style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '350px', boxShadow: 'var(--shadow-xl)' }}>
      <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Race Finished</h3>
        <button type="button" className="icon-action" onClick={() => setIsRaceFinishedModalOpen(false)}>
          <X size={24} />
        </button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p>All coordinates successfully uploaded and the route has been saved locally.</p>
      </div>
    </div>
  </div>
)}
    {isAttributionModalOpen && (
  <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setIsAttributionModalOpen(false)}>
    <div className="modal-content" style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '350px', boxShadow: 'var(--shadow-xl)' }} onClick={e => e.stopPropagation()}>
      <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>Map Info</h3>
        <button type="button" className="icon-action" onClick={() => setIsAttributionModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
        <p style={{ margin: 0 }}><strong>Leaflet</strong> | Seamarks &copy; <a href='http://www.openseamap.org' target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>OpenSeaMap</a> contributors | Base map &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>CARTO</a></p>
      </div>
    </div>
  </div>
)}
</div>
  );
}
