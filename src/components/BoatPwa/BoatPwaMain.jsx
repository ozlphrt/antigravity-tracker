import React, { useState, useEffect, useRef } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { Navigation, LocateFixed, Maximize, Plus, Minus } from 'lucide-react';
import { useGpsTracker } from '../../hooks/useGpsTracker';
import { supabase } from '../../database/mockSupabase';
import RaceLineMarker from '../RaceLineMarker';
import TapeCompass from './TapeCompass';

// Dynamic rotated boat icon (top-down view)
const createRotatedBoatIcon = (heading) => {
  return new L.DivIcon({
    html: `<div style="transform: rotate(${heading}deg); width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.3));">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#33658A" stroke="#fff" stroke-width="2" stroke-linejoin="round" width="30" height="30">
        <path d="M12 2 L19 21 Q12 18 5 21 Z" />
      </svg>
    </div>`,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
};

const buoyIcon = new L.DivIcon({
  html: `<div style="width: 18px; height: 18px; border-radius: 50%; background: #F26419; border: 3px solid #fff; box-shadow: 0 2px 5px rgba(15,23,42,0.25);"></div>`,
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const createTargetBuoyIcon = (rounding) => {
  const isPort = rounding.toLowerCase() === 'port';
  const svgPath = isPort 
    ? `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>` 
    : `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`;
    
  const animClass = isPort ? 'buoy-spin-ccw' : 'buoy-spin-cw';
    
  return new L.DivIcon({
    html: `<div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#F26419" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="${animClass}">
        ${svgPath}
      </svg>
      <svg style="position: absolute;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#F26419" width="16" height="16">
        <circle cx="12" cy="12" r="8"/>
      </svg>
    </div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
};

const portTargetIcon = createTargetBuoyIcon('PORT');
const stbdTargetIcon = createTargetBuoyIcon('STBD');

const getCheckpointKind = (checkpoint) => {
  if (checkpoint.kind) return checkpoint.kind;
  if (checkpoint.id === 'S' || checkpoint.id === 'start') return 'start';
  if (checkpoint.id === 'F' || checkpoint.id === 'finish') return 'finish';
  return checkpoint.type;
};

const isRaceTarget = (checkpoint) => {
  const kind = getCheckpointKind(checkpoint);
  return kind === 'buoy' || kind === 'gate' || kind === 'finish';
};

function MapControls({ pos, autoCenter, setAutoCenter }) {
  const map = useMap();
  const lastCenterEnableTime = useRef(0);
  
  useEffect(() => {
    if (autoCenter && pos) {
      // Wait 1.2s before continuous panning to allow the initial flyTo animation to finish
      if (Date.now() - lastCenterEnableTime.current > 1200) {
        map.setView([pos.lat, pos.lng], map.getZoom(), { animate: false });
      }
    }
  }, [autoCenter, pos.lat, pos.lng, map]);

  useEffect(() => {
    const disableAuto = () => {
      setAutoCenter(false);
    };
    map.on('dragstart', disableAuto);
    map.on('zoomstart', disableAuto); // Disable if user pinches to zoom
    return () => {
      map.off('dragstart', disableAuto);
      map.off('zoomstart', disableAuto);
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
            map.flyTo([pos.lat, pos.lng], 14, { duration: 1.2 });
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
            setAutoCenter(false);
            map.zoomIn();
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
            setAutoCenter(false);
            map.zoomOut();
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

export default function BoatPwaMain({ courseOverride, onStatusChange, showDots = true }) {
  const [enabled, setEnabled] = useState(true);
  const { position, isOnline, offlineQueueSize } = useGpsTracker('boat-1', enabled);
  const [course, setCourse] = useState(null);
  const [simulatedPos, setSimulatedPos] = useState({ lat: 37.0255, lng: 27.4325, heading: 180, targetHeading: 180, speed: 6.0, timeMultiplier: 20 });
  const [trace, setTrace] = useState([]);
  const [autoCenter, setAutoCenter] = useState(true);
  const [activeTargetIndex, setActiveTargetIndex] = useState(0);

  // Telemetry & Offline State
  const [isSimOnline, setIsSimOnline] = useState(true);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [syncingQueue, setSyncingQueue] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState(Date.now());
  const lastCapturedPos = useRef(null);

  useEffect(() => {
    if (!onStatusChange) return;
    onStatusChange({
      state: isSyncing ? 'syncing' : (isSimOnline ? 'online' : 'buffering'),
      queueSize: offlineQueue.length + syncingQueue.length,
      pointsRecorded: trace.length,
      lastSynced: lastSyncedTime,
      resolution: '± 4.2m',
      collectionStatus: enabled ? 'Active' : 'Paused'
    });
  }, [isSimOnline, isSyncing, offlineQueue.length, syncingQueue.length, trace.length, lastSyncedTime, enabled, onStatusChange]);

  useEffect(() => {
    if (courseOverride) {
      setCourse(courseOverride);
      setActiveTargetIndex(0);
      minDistanceRef.current = Infinity;
      return;
    }

    supabase.getCourses().then(courses => setCourse(courses[0]));
  }, [courseOverride]);

  // Simple GPS simulator
  useEffect(() => {
    let interval;
    if (enabled) {
      interval = setInterval(() => {
        setSimulatedPos(prev => {
          let currentHdg = prev.heading;
          let targetHdg = prev.targetHeading !== undefined ? prev.targetHeading : currentHdg;
          
          if (targetHdg !== currentHdg) {
            let diff = targetHdg - currentHdg;
            
            if (Math.abs(diff) <= 0.5) {
              currentHdg = targetHdg;
            } else {
              // 20 FPS Ease-out interpolation
              let turnSpeed = Math.abs(diff) * 0.1;
              turnSpeed = Math.min(Math.max(turnSpeed, 0.2), 2.0); // max 40 deg/sec
              currentHdg += Math.sign(diff) * turnSpeed;
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
  }, [enabled]);

  // Sync simulator to tracker (mocking the real navigator.geolocation for local demo)
  useEffect(() => {
    if (enabled && navigator.geolocation.mock) {
       // if we were strictly intercepting. Instead we'll just display simulatedPos directly 
       // but in a real PWA this uses useGpsTracker position
    }
  }, [simulatedPos, enabled]);

  const activePos = enabled ? simulatedPos : (position || simulatedPos);
  const minDistanceRef = useRef(Infinity);

  // Auto-advance to next buoy using Closest Point of Approach (CPA)
  useEffect(() => {
    if (!course || !activePos) return;
    const targets = course.checkpoints.filter(isRaceTarget);
    const target = targets[activeTargetIndex];
    if (target) {
      let tLat, tLng;
      if (getCheckpointKind(target) === 'buoy') {
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
      }
      
      // Clear buoy early: when we are close to the mark (within 300m) and the mark is now passing behind us
      // (relative bearing > 100 degrees off the bow), we assume "75% of the turn is completed".
      if (minDistanceRef.current < 0.3 && Math.abs(relativeBearing) > 100) {
        if (activeTargetIndex < targets.length) {
          setActiveTargetIndex(prev => prev + 1);
          minDistanceRef.current = Infinity; // Reset for next target
        }
      } else if (distance > minDistanceRef.current + 0.1 && minDistanceRef.current < 0.4) {
        // Fallback: Turn completed by sailing away
        if (activeTargetIndex < targets.length) {
          setActiveTargetIndex(prev => prev + 1);
          minDistanceRef.current = Infinity; // Reset for next target
        }
      }
    }
  }, [activePos, course, activeTargetIndex]);

  // Calculate relative bearing to the next target
  let relativeAngle = 0;
  let targetBearing = null;
  let targetName = 'None';
  let targetRounding = '';
  let targetPos = null;
  
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
    } else {
      targetName = 'FINISHED';
    }
  }

  return (
    <div className="map-container">
      <MapContainer center={[37.015, 27.420]} zoom={14} zoomControl={false} preferCanvas={true} style={{ width: '100%', height: '100%' }}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution="&copy; OpenStreetMap contributors &copy; CARTO"
        />
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
              <Marker position={[activePos.lat, activePos.lng]} icon={createRotatedBoatIcon(activePos.heading)} />
            </React.Fragment>
          );
        })()}
        
        {targetPos && targetRounding !== 'LINE' && targetName !== 'FINISHED' && (
          <BuoyCircles targetPos={targetPos} />
        )}
        
        {course && course.checkpoints.map((cp, idx) => {
          if (cp.type === 'buoy') {
             let iconToUse = buoyIcon;
             const isTarget = cp.id.toUpperCase() === targetName;
             if (isTarget) {
               iconToUse = cp.rounding.toUpperCase() === 'PORT' ? portTargetIcon : stbdTargetIcon;
             }
             return <Marker key={idx} position={[cp.coord[0], cp.coord[1]]} icon={iconToUse} opacity={isTarget ? 1 : 0.4} />;
          } else if (cp.type === 'gate') {
             const kind = getCheckpointKind(cp);
             const isTarget = cp.id.toUpperCase() === targetName;
             
             const lineKind = kind === 'finish' ? 'finish' : kind === 'start' ? 'start' : 'gate';
             return (
               <RaceLineMarker
                 key={idx}
                 coords={cp.coords}
                 kind={lineKind}
                 crossing={cp.crossing}
                 opacity={isTarget ? 1 : 0.4}
               />
             );
          }
          return null;
        })}
      </MapContainer>

      <div className="simulator-panel glass-panel">
        <div className="dir-buttons" style={{ marginTop: 0 }}>
          <button onClick={() => setSimulatedPos(p => ({...p, targetHeading: (p.targetHeading !== undefined ? p.targetHeading : p.heading) - 10}))}>Port</button>
          <button onClick={() => setSimulatedPos(p => ({...p, targetHeading: (p.targetHeading !== undefined ? p.targetHeading : p.heading) + 10}))}>Stbd</button>
        </div>
      </div>

      <div className="helm-dashboard glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>HEADING</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--accent-coral)' }}>TARGET: {targetName} ({targetRounding})</span>
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
  );
}
