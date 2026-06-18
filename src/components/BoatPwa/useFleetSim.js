import { useEffect, useRef, useState, useCallback } from 'react';
import * as turf from '@turf/turf';
import { AI_FLEET } from './fleetConfig';

const isRaceTarget = (cp) =>
  cp.kind === 'start' || cp.kind === 'finish' || cp.kind === 'gate' || cp.kind === 'buoy';

const getCheckpointKind = (cp) => cp.kind || cp.type;

/** Compute arrowBearing for a line checkpoint */
function getLineBearing(cp) {
  if (cp.crossing === 'center') return (cp.rotationDeg || 0);
  const ptA = turf.point([cp.coords[0][1], cp.coords[0][0]]);
  const ptB = turf.point([cp.coords[1][1], cp.coords[1][0]]);
  const lb = turf.bearing(ptA, ptB);
  return lb + (cp.crossing === 'up' ? -90 : 90);
}

/** Spawn positions: staggered side-by-side behind the start line */
function buildSpawnPositions(course) {
  const targets = course.checkpoints.filter(isRaceTarget);
  const startCp = targets.find(cp => cp.kind === 'start');
  if (!startCp) return AI_FLEET.map((_, i) => ({ lat: 37.0255 + i * 0.001, lng: 27.4325, heading: 180 }));

  const sLat = (startCp.coords[0][0] + startCp.coords[1][0]) / 2;
  const sLng = (startCp.coords[0][1] + startCp.coords[1][1]) / 2;
  const startPt = turf.point([sLng, sLat]);

  const arrowBearing = getLineBearing(startCp);
  const reverseBearing = (arrowBearing + 180 + 360) % 360;
  const perpBearing = (arrowBearing + 90 + 360) % 360;

  // Spawn 300m behind start line, spread 50m apart laterally
  return AI_FLEET.map((_, i) => {
    const lateralOffset = (i - (AI_FLEET.length - 1) / 2) * 0.05; // km
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
        let tLat, tLng;
        const kind = getCheckpointKind(target);

        if (kind === 'buoy') {
          tLat = target.coord[0]; tLng = target.coord[1];
        } else {
          tLat = (target.coords[0][0] + target.coords[1][0]) / 2;
          tLng = (target.coords[0][1] + target.coords[1][1]) / 2;
        }
        const tPt = turf.point([tLng, tLat]);

        let desiredBearing;
        if (kind === 'buoy') {
          // Aim slightly offset to round the buoy on the correct side
          const prevTarget = targets[tIdx - 1];
          let approachBearing = 0;
          if (prevTarget) {
            let pLat, pLng;
            if (prevTarget.kind === 'buoy' && prevTarget.coord) { pLat = prevTarget.coord[0]; pLng = prevTarget.coord[1]; }
            else if (prevTarget.coords) { pLat = (prevTarget.coords[0][0] + prevTarget.coords[1][0])/2; pLng = (prevTarget.coords[0][1] + prevTarget.coords[1][1])/2; }
            if (pLat !== undefined) approachBearing = turf.bearing(turf.point([pLng, pLat]), tPt);
          }
          const isPort = (target.rounding || 'port').toLowerCase() === 'port';
          const offsetPt = turf.destination(tPt, 0.04, approachBearing + (isPort ? 90 : -90), { units: 'kilometers' });
          desiredBearing = turf.bearing(boatPt, offsetPt);
        } else {
          const arrowBearing = (getLineBearing(target) + 360) % 360;
          const dist = turf.distance(boatPt, tPt, { units: 'kilometers' });
          if (dist <= 0.2) {
            desiredBearing = arrowBearing;
          } else {
            const reverseBearing = (arrowBearing + 180) % 360;
            const approachPt = turf.destination(tPt, 0.1, reverseBearing, { units: 'kilometers' });
            desiredBearing = turf.bearing(boatPt, approachPt);
          }
        }

        // Sailboat tactical deviations:
        // Instead of all taking the exact same line, boats tack/gybe or sail slightly higher/lower angles to gain speed
        const boatIdx = AI_FLEET.findIndex(b => b.id === boat.id);
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
          desiredBearing = repBearing;
        }

        // Smooth turn toward desired bearing
        const normDesired = (desiredBearing + 360) % 360;
        return { ...boat, targetHeading: normDesired, speed: currentSpeed };
      });
    }, 100);

    const moveInterval = setInterval(() => {
      const newTrailPoints = {};
      boatsRef.current = boatsRef.current.map(boat => {
        // Turn
        let hdg = boat.heading;
        let targetHdg = boat.targetHeading ?? hdg;
        let diff = targetHdg - hdg;
        while (diff <= -180) diff += 360;
        while (diff > 180) diff -= 360;
        if (Math.abs(diff) <= 0.5) hdg = targetHdg;
        else {
          let turnSpeed = Math.min(Math.max(Math.abs(diff) * 0.1, 0.2), 2.0);
          hdg = (hdg + Math.sign(diff) * turnSpeed + 360) % 360;
        }

        // Move
        const hdgRad = hdg * Math.PI / 180;
        const dist = (boat.speed * timeMultiplier * 0.514444) * 0.05; // 50ms at speed knots (scaled by timeMultiplier)
        const newLat = boat.lat + (dist / 111111) * Math.cos(hdgRad);
        const newLng = boat.lng + (dist / (111111 * Math.cos(boat.lat * Math.PI / 180))) * Math.sin(hdgRad);

        newTrailPoints[boat.id] = { lat: newLat, lng: newLng };

        // Check line crossing / buoy CPA for target advancement
        const tIdx = targetIndexRef.current[boat.id] ?? 0;
        const targets2 = course.checkpoints.filter(isRaceTarget);
        const target = targets2[tIdx];
        if (target) {
          const kind = getCheckpointKind(target);
          const lastPos = lastPosRef.current[boat.id];

          if (kind !== 'buoy' && lastPos && (lastPos.lat !== newLat || lastPos.lng !== newLng)) {
            try {
              const boatPath = turf.lineString([[lastPos.lng, lastPos.lat], [newLng, newLat]]);
              const targetLine = turf.lineString([
                [target.coords[0][1], target.coords[0][0]],
                [target.coords[1][1], target.coords[1][0]],
              ]);
              const intersects = turf.lineIntersect(boatPath, targetLine);
              if (intersects.features.length > 0) {
                targetIndexRef.current[boat.id] = tIdx + 1;
              }
            } catch (_) { /* ignore geometry errors */ }
          } else if (kind === 'buoy') {
            const bPt = turf.point([newLng, newLat]);
            const tPt = turf.point([target.coord[1], target.coord[0]]);
            const distToBuoy = turf.distance(bPt, tPt, { units: 'kilometers' });

            // Check if we have passed the buoy plane (dot product of approach vector and boat position relative to buoy)
            let hasPassed = false;
            const prevTarget = targets2[tIdx - 1];
            if (prevTarget) {
              let pLat, pLng;
              if (prevTarget.kind === 'buoy' && prevTarget.coord) { pLat = prevTarget.coord[0]; pLng = prevTarget.coord[1]; }
              else if (prevTarget.coords) { pLat = (prevTarget.coords[0][0] + prevTarget.coords[1][0])/2; pLng = (prevTarget.coords[0][1] + prevTarget.coords[1][1])/2; }
              
              if (pLat !== undefined && pLng !== undefined) {
                const vX = target.coord[1] - pLng;
                const vY = target.coord[0] - pLat;
                const wX = newLng - target.coord[1];
                const wY = newLat - target.coord[0];
                const dot = vX * wX + vY * wY;
                if (dot > 0) {
                  hasPassed = true;
                }
              }
            } else {
              hasPassed = true;
            }

            // We must be close to the buoy (under 80m) and have passed the plane, or be extremely close (20m safety fallback)
            if ((hasPassed && distToBuoy < 0.08) || distToBuoy < 0.02) {
              targetIndexRef.current[boat.id] = tIdx + 1;
            }
          }
        }

        lastPosRef.current[boat.id] = { lat: newLat, lng: newLng };
        return { ...boat, heading: hdg, targetHeading: targetHdg, lat: newLat, lng: newLng };
      });

      setBoats([...boatsRef.current]);
      setTrails(prev => {
        const next = { ...prev };
        Object.entries(newTrailPoints).forEach(([id, pt]) => {
          const trail = next[id] || [];
          // Keep last 300 trail points per boat
          next[id] = [...trail.slice(-299), pt];
        });
        return next;
      });
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
    setBoats(reset);
    setTrails(Object.fromEntries(AI_FLEET.map(b => [b.id, []])));
  }, [course]);

  return { boats, trails, resetFleet };
}
