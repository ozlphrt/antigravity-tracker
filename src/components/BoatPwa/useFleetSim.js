import { useEffect, useRef, useState, useCallback } from 'react';
import * as turf from '@turf/turf';
import { AI_FLEET } from './fleetConfig';

const getCheckpointKind = (checkpoint) => {
  if (!checkpoint) return '';
  if (checkpoint.kind) return checkpoint.kind;
  if (checkpoint.id === 'S' || checkpoint.id === 'start') return 'start';
  if (checkpoint.id === 'F' || checkpoint.id === 'finish') return 'finish';
  return checkpoint.type;
};

const isRaceTarget = (cp) => {
  const k = getCheckpointKind(cp);
  return k === 'start' || k === 'finish' || k === 'gate' || k === 'buoy';
};

function getCheckpointCoords(cp) {
  if (!cp) return null;
  if (cp.coords && cp.coords.length >= 2) return cp.coords;
  if (cp.coord) {
    const center = turf.point([cp.coord[1], cp.coord[0]]);
    const width = cp.width || 120;
    const rotation = cp.rotationDeg !== undefined ? cp.rotationDeg : 270;
    const angleA = (rotation + 90) % 360;
    const angleB = (rotation - 90 + 360) % 360;
    const halfDistKm = (width / 2) / 1000;
    const ptA = turf.destination(center, halfDistKm, angleA, { units: 'kilometers' });
    const ptB = turf.destination(center, halfDistKm, angleB, { units: 'kilometers' });
    return [
      [ptA.geometry.coordinates[1], ptA.geometry.coordinates[0]],
      [ptB.geometry.coordinates[1], ptB.geometry.coordinates[0]]
    ];
  }
  return null;
}

function getCheckpointCenter(cp) {
  if (!cp) return null;
  if (cp.coord) return { lat: cp.coord[0], lng: cp.coord[1] };
  const coords = getCheckpointCoords(cp);
  if (coords && coords.length > 0) {
    const lats = coords.map(c => c[0]);
    const lngs = coords.map(c => c[1]);
    return {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lng: lngs.reduce((a, b) => a + b, 0) / lngs.length
    };
  }
  return null;
}

function getLineBearing(cp) {
  if (!cp) return 0;
  if (cp.crossing === 'center') return (cp.rotationDeg || 0);
  const coords = getCheckpointCoords(cp);
  if (!coords || coords.length < 2) return cp.rotationDeg || 0;
  const ptA = turf.point([coords[0][1], coords[0][0]]);
  const ptB = turf.point([coords[1][1], coords[1][0]]);
  const lb = turf.bearing(ptA, ptB);
  return (lb + (cp.crossing === 'up' ? -90 : 90) + 360) % 360;
}

/** Spawn positions: staggered side-by-side behind the start line */
function buildSpawnPositions(course) {
  if (!course || !course.checkpoints) {
    return AI_FLEET.map((_, i) => ({ lat: 37.0255 + i * 0.001, lng: 27.4325, heading: 180 }));
  }
  const targets = course.checkpoints.filter(isRaceTarget);
  const startCp = targets.find(cp => getCheckpointKind(cp) === 'start');
  if (!startCp) return AI_FLEET.map((_, i) => ({ lat: 37.0255 + i * 0.001, lng: 27.4325, heading: 180 }));

  const coords = getCheckpointCoords(startCp);
  if (!coords || coords.length < 2) {
    if (startCp.coord) {
      return AI_FLEET.map((_, i) => ({
        lat: startCp.coord[0] + (i - 4) * 0.0001,
        lng: startCp.coord[1] + (i - 4) * 0.0001,
        heading: startCp.rotationDeg || 0
      }));
    }
    return AI_FLEET.map((_, i) => ({ lat: 37.0255 + i * 0.001, lng: 27.4325, heading: 180 }));
  }

  const sLat = (coords[0][0] + coords[1][0]) / 2;
  const sLng = (coords[0][1] + coords[1][1]) / 2;
  const startPt = turf.point([sLng, sLat]);

  const arrowBearing = getLineBearing(startCp);
  const reverseBearing = (arrowBearing + 180 + 360) % 360;
  const perpBearing = (arrowBearing + 90 + 360) % 360;

  const startWidth = startCp.width || 300;

  // Spawn 300m behind start line, spread laterally to match their start line target fractions exactly
  return AI_FLEET.map((_, i) => {
    const fraction = 0.25 + 0.5 * (i / (AI_FLEET.length - 1));
    const lateralOffset = (fraction - 0.5) * (startWidth / 1000); // km offset from start line midpoint
    const behindPt = turf.destination(startPt, 0.3, reverseBearing, { units: 'kilometers' });
    const spawnPt = turf.destination(behindPt, Math.abs(lateralOffset), perpBearing * Math.sign(lateralOffset || 1), { units: 'kilometers' });
    return {
      lat: spawnPt.geometry.coordinates[1],
      lng: spawnPt.geometry.coordinates[0],
      heading: (arrowBearing + 360) % 360,
    };
  });
}

/**
 * useFleetSim — drives 9 AI boats around the course.
 * Returns: boats array + trails map { boatId -> [{lat,lng}] }
 */
export function useFleetSim(course, isSimMode, timeMultiplier = 20) {
  const [boats, setBoats] = useState([]);
  const [trails, setTrails] = useState({});
  const boatsRef = useRef([]);  // mutable ref for the tight simulation loop
  const targetIndexRef = useRef({}); // { boatId -> activeTargetIndex }
  const lastPosRef = useRef({});     // { boatId -> {lat,lng} } for line intersection
  const minDistanceRef = useRef({}); // { boatId -> minDistance }
  const closestSideRef = useRef({});  // { boatId -> closestSide }
  const hasPassedEntranceRef = useRef({}); // { boatId -> hasPassedEntrance }
  const lastLoggedTrailRef = useRef({}); // { boatId -> {lat,lng,hdg,time} }

  // Initialise boats when course becomes available
  useEffect(() => {
    if (!course || !isSimMode) return;
    const spawns = buildSpawnPositions(course);
    const initial = AI_FLEET.map((cfg, i) => ({
      ...cfg,
      lat: spawns[i].lat,
      lng: spawns[i].lng,
      heading: spawns[i].heading,
      targetHeading: spawns[i].heading,
      speed: 5.5 + Math.random() * 2.0, // 5.5–7.5 knots variability
    }));
    boatsRef.current = initial;
    targetIndexRef.current = Object.fromEntries(AI_FLEET.map(b => [b.id, 0]));
    lastPosRef.current = {};
    minDistanceRef.current = Object.fromEntries(AI_FLEET.map(b => [b.id, Infinity]));
    closestSideRef.current = Object.fromEntries(AI_FLEET.map(b => [b.id, null]));
    hasPassedEntranceRef.current = Object.fromEntries(AI_FLEET.map(b => [b.id, false]));
    lastLoggedTrailRef.current = {};
    setBoats(initial);
    setTrails(Object.fromEntries(AI_FLEET.map(b => [b.id, []])));
  }, [course, isSimMode]);

  // Steering + movement loop
  useEffect(() => {
    if (!course || !isSimMode || boatsRef.current.length === 0) return;
    const targets = course.checkpoints.filter(isRaceTarget);
    if (targets.length === 0) return;

    const steerInterval = setInterval(() => {
      boatsRef.current = boatsRef.current.map(boat => {
        const tIdx = targetIndexRef.current[boat.id] ?? 0;
        const target = targets[tIdx];
        if (!target) return boat; // finished

        const boatPt = turf.point([boat.lng, boat.lat]);
        const boatIdx = AI_FLEET.findIndex(b => b.id === boat.id);
        let tLat, tLng;
        const kind = getCheckpointKind(target);

        if (kind === 'buoy') {
          tLat = target.coord[0]; tLng = target.coord[1];
        } else {
          const coords = getCheckpointCoords(target);
          if (coords && coords.length >= 2) {
            const ptA = turf.point([coords[0][1], coords[0][0]]);
            const ptB = turf.point([coords[1][1], coords[1][0]]);
            const lineLengthKm = turf.distance(ptA, ptB, { units: 'kilometers' });
            const fraction = 0.25 + 0.5 * (Math.max(boatIdx, 0) / Math.max(AI_FLEET.length - 1, 1));
            const targetPtOnLine = turf.along(turf.lineString([
              [coords[0][1], coords[0][0]],
              [coords[1][1], coords[1][0]]
            ]), lineLengthKm * fraction, { units: 'kilometers' });
            tLat = targetPtOnLine.geometry.coordinates[1];
            tLng = targetPtOnLine.geometry.coordinates[0];
          } else {
            const center = getCheckpointCenter(target) || { lat: 37.0255, lng: 27.4325 };
            tLat = center.lat;
            tLng = center.lng;
          }
        }
        const tPt = turf.point([tLng, tLat]);

        let desiredBearing;
        if (kind === 'buoy') {
          // Aim slightly offset to round the buoy on the correct side
          const prevTarget = targets[tIdx - 1];
          let approachBearing = 0;
          if (prevTarget) {
            const prevCenter = getCheckpointCenter(prevTarget);
            if (prevCenter) {
              approachBearing = turf.bearing(turf.point([prevCenter.lng, prevCenter.lat]), tPt);
            }
          }

          let exitBearing = approachBearing;
          const nextTarget = targets[tIdx + 1];
          if (nextTarget) {
            const nextCenter = getCheckpointCenter(nextTarget);
            if (nextCenter) {
              exitBearing = turf.bearing(tPt, turf.point([nextCenter.lng, nextCenter.lat]));
            }
          }

          const isPort = (target.rounding || 'port').toLowerCase() === 'port';
          const offsetBearing = hasPassedEntranceRef.current[boat.id]
              ? (exitBearing + (isPort ? 90 : -90))
              : (approachBearing + (isPort ? 90 : -90));

          const offsetDistance = 0.040 + boatIdx * 0.007; // Staggered lanes from 40m to 96m
          const offsetPt = turf.destination(tPt, offsetDistance, offsetBearing, { units: 'kilometers' });
          desiredBearing = turf.bearing(boatPt, offsetPt);
        } else {
          const dist = turf.distance(boatPt, tPt, { units: 'kilometers' });
          if (dist <= 0.12) {
            desiredBearing = (getLineBearing(target) + 360) % 360;
          } else {
            desiredBearing = turf.bearing(boatPt, tPt);
          }
        }

        // Sailboat tactical deviations:
        // Instead of all taking the exact same line, boats tack/gybe or sail slightly higher/lower angles to gain speed
        const timeSec = Date.now() / 1000;
        
        // Dynamic oscillation per boat (e.g. cycles between 20s and 45s)
        const cyclePeriod = 20 + (boatIdx * 6.5);
        const maxTackAngle = 18 + (boatIdx % 3) * 5; // 18 to 28 degrees deviation
        const phaseShift = boatIdx * (Math.PI / 4.5);
        
        const wave = Math.sin((timeSec / cyclePeriod) * 2 * Math.PI + phaseShift);
        
        const tackAngle = wave * maxTackAngle;
        
        // Speed scaling: when heading off/hotter angle (weaving), speed increases (heeling/drift acceleration)
        // Up to 25% speed fluctuation based on point-of-sail
        const speedFactor = 0.95 + Math.abs(wave) * 0.25; 
        const baseSpeed = 5.0 + (boatIdx % 4) * 0.4; // 5.0 to 6.2 knots base
        const currentSpeed = baseSpeed * speedFactor;

        // Dampen weaving as they approach the buoy/line (< 120m) to keep roundings precise
        const distToTarget = turf.distance(boatPt, tPt, { units: 'kilometers' });
        const weaveDampening = Math.min(distToTarget / 0.12, 1);
        
        desiredBearing = (desiredBearing + tackAngle * weaveDampening + 360) % 360;

        // Collision repulsion: push away from other boats within 40m
        let repulsionX = 0, repulsionY = 0;
        boatsRef.current.forEach(other => {
          if (other.id === boat.id) return;
          const d = turf.distance(boatPt, turf.point([other.lng, other.lat]), { units: 'kilometers' });
          if (d < 0.04 && d > 0) {
            const repBearing = turf.bearing(turf.point([other.lng, other.lat]), boatPt);
            const strength = (0.04 - d) / 0.04; // 0–1
            repulsionX += Math.sin(repBearing * Math.PI / 180) * strength * 60;
            repulsionY += Math.cos(repBearing * Math.PI / 180) * strength * 60;
          }
        });
        if (repulsionX !== 0 || repulsionY !== 0) {
          const repBearing = (Math.atan2(repulsionX, repulsionY) * 180 / Math.PI + 360) % 360;
          // Blend target bearing and repulsion bearing gently to avoid overriding the course target entirely
          let diff = repBearing - desiredBearing;
          while (diff <= -180) diff += 360;
          while (diff > 180) diff -= 360;
          desiredBearing = (desiredBearing + diff * 0.25 + 360) % 360;
        }

        // Smooth turn toward desired bearing
        const normDesired = (desiredBearing + 360) % 360;
        return { ...boat, targetHeading: normDesired, speed: currentSpeed };
      });
    }, 100);

    const moveInterval = setInterval(() => {
      const newTrailPointsToLog = {};
      const nowTime = Date.now();
      boatsRef.current = boatsRef.current.map(boat => {
        const boatIdx = AI_FLEET.findIndex(b => b.id === boat.id);
        // Turn
        let hdg = boat.heading;
        let targetHdg = boat.targetHeading ?? hdg;
        let diff = targetHdg - hdg;
        while (diff <= -180) diff += 360;
        while (diff > 180) diff -= 360;
        if (Math.abs(diff) <= 0.5) hdg = targetHdg;
        else {
          const maxTurnSpeed = 1.8 + (timeMultiplier * 0.16); // scales turn rate with timeMultiplier to keep turning radius physically realistic
          let turnSpeed = Math.min(Math.max(Math.abs(diff) * 0.15, 0.25), maxTurnSpeed);
          hdg = (hdg + Math.sign(diff) * turnSpeed + 360) % 360;
        }

        // Move
        const hdgRad = hdg * Math.PI / 180;
        const dist = (boat.speed * timeMultiplier * 0.514444) * 0.05; // 50ms at speed knots (scaled by timeMultiplier)
        const newLat = boat.lat + (dist / 111111) * Math.cos(hdgRad);
        const newLng = boat.lng + (dist / (111111 * Math.cos(boat.lat * Math.PI / 180))) * Math.sin(hdgRad);

        // Smart Trail Logger (only log if moved > 5m, turned > 3deg, or > 1.5s passed)
        const lastLog = lastLoggedTrailRef.current[boat.id];
        let shouldLog = false;
        if (!lastLog) {
          shouldLog = true;
        } else {
          const distKm = turf.distance(turf.point([lastLog.lng, lastLog.lat]), turf.point([newLng, newLat]), { units: 'kilometers' });
          let hdgDiff = Math.abs(hdg - lastLog.hdg);
          if (hdgDiff > 180) hdgDiff = 360 - hdgDiff;
          if (distKm > 0.005 || hdgDiff > 3 || (nowTime - lastLog.time) > 1500) {
            shouldLog = true;
          }
        }
        
        if (shouldLog) {
          lastLoggedTrailRef.current[boat.id] = { lat: newLat, lng: newLng, hdg: hdg, time: nowTime };
          newTrailPointsToLog[boat.id] = { lat: newLat, lng: newLng };
        }

        // Check line crossing / buoy CPA for target advancement
        const tIdx = targetIndexRef.current[boat.id] ?? 0;
        const targets2 = course.checkpoints.filter(isRaceTarget);
        const target = targets2[tIdx];
        if (target) {
          const kind = getCheckpointKind(target);
          const lastPos = lastPosRef.current[boat.id];

          if (kind !== 'buoy' && lastPos && (lastPos.lat !== newLat || lastPos.lng !== newLng)) {
            try {
              const coords = getCheckpointCoords(target);
              if (coords && coords.length >= 2) {
                const boatPath = turf.lineString([[lastPos.lng, lastPos.lat], [newLng, newLat]]);
                const targetLine = turf.lineString([
                  [coords[0][1], coords[0][0]],
                  [coords[1][1], coords[1][0]],
                ]);
                const intersects = turf.lineIntersect(boatPath, targetLine);
                if (intersects.features.length > 0) {
                  console.log(`Boat ${boat.id} crossed line ${target.id}!`);
                  targetIndexRef.current[boat.id] = tIdx + 1;
                }
              }
            } catch (e) {
              console.error(`Error in crossing check for boat ${boat.id}:`, e);
            }
          } else if (kind === 'buoy') {
            const bPt = turf.point([newLng, newLat]);
            const tPt = turf.point([target.coord[1], target.coord[0]]);
            const distance = turf.distance(bPt, tPt, { units: 'kilometers' });
            
            // Robust proximity check for AI simulated boats (offset lane distance + 150m leeway)
            const maxRoundingDist = 0.040 + boatIdx * 0.007 + 0.150; 
            if (distance < maxRoundingDist) {
              targetIndexRef.current[boat.id] = tIdx + 1;
              minDistanceRef.current[boat.id] = Infinity;
              closestSideRef.current[boat.id] = null;
              hasPassedEntranceRef.current[boat.id] = false;
            }
          }
        }

        lastPosRef.current[boat.id] = { lat: newLat, lng: newLng };
        return { ...boat, heading: hdg, targetHeading: targetHdg, lat: newLat, lng: newLng };
      });

      setBoats([...boatsRef.current]);
      
      if (Object.keys(newTrailPointsToLog).length > 0) {
        setTrails(prev => {
          const next = { ...prev };
          Object.entries(newTrailPointsToLog).forEach(([id, pt]) => {
            const trail = next[id] || [];
            // Keep last 300 trail points per boat (approx 5 to 10 mins of sailing)
            next[id] = [...trail.slice(-299), pt];
          });
          return next;
        });
      }
    }, 50);

    return () => {
      clearInterval(steerInterval);
      clearInterval(moveInterval);
    };
  }, [course, isSimMode, timeMultiplier]);

  const resetFleet = useCallback(() => {
    if (!course) return;
    const spawns = buildSpawnPositions(course);
    const reset = AI_FLEET.map((cfg, i) => ({
      ...cfg,
      lat: spawns[i].lat,
      lng: spawns[i].lng,
      heading: spawns[i].heading,
      targetHeading: spawns[i].heading,
      speed: 5.5 + Math.random() * 2.0,
    }));
    boatsRef.current = reset;
    targetIndexRef.current = Object.fromEntries(AI_FLEET.map(b => [b.id, 0]));
    lastPosRef.current = {};
    minDistanceRef.current = Object.fromEntries(AI_FLEET.map(b => [b.id, Infinity]));
    closestSideRef.current = Object.fromEntries(AI_FLEET.map(b => [b.id, null]));
    hasPassedEntranceRef.current = Object.fromEntries(AI_FLEET.map(b => [b.id, false]));
    lastLoggedTrailRef.current = {};
    setBoats(reset);
    setTrails(Object.fromEntries(AI_FLEET.map(b => [b.id, []])));
  }, [course]);

  return { boats, trails, resetFleet };
}
