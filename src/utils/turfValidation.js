import * as turf from '@turf/turf';

/**
 * Checks if a track crosses a gate (start or finish line).
 * @param {Array} trackPoints - Array of {lat, lng} points representing the boat's path.
 * @param {Array} gateLine - Array of two points [[lat, lng], [lat, lng]] defining the gate.
 * @returns {boolean} true if the track intersects the gate.
 */
export const checkGateCrossing = (trackPoints, gateLine) => {
  if (trackPoints.length < 2) return false;
  
  const gateString = turf.lineString([
    [gateLine[0][1], gateLine[0][0]], // turf uses [lng, lat]
    [gateLine[1][1], gateLine[1][0]]
  ]);

  const trackCoords = trackPoints.map(p => [p.lng, p.lat]);
  const trackString = turf.lineString(trackCoords);

  const intersects = turf.lineIntersect(gateString, trackString);
  return intersects.features.length > 0;
};

/**
 * Validates if a boat rounded a buoy on the correct side (port or starboard).
 * Port rounding means turning counter-clockwise around the buoy (buoy is on the left of the boat).
 * Starboard rounding means turning clockwise around the buoy (buoy is on the right of the boat).
 * 
 * @param {Array} trackPoints - Array of {lat, lng} points.
 * @param {Object} buoy - { coord: [lat, lng], rounding: 'port' | 'starboard' }
 * @param {number} thresholdKm - The radius within which we consider the boat to be rounding the buoy.
 * @returns {boolean|null} true if successful, false if violated, null if not reached yet.
 */
export const checkBuoyRounding = (trackPoints, buoy, thresholdKm = 0.1) => {
  if (trackPoints.length < 3) return null;

  const buoyPt = turf.point([buoy.coord[1], buoy.coord[0]]); // [lng, lat]
  
  // Find track points within the threshold radius
  const pointsInRange = trackPoints.filter(p => {
    const pt = turf.point([p.lng, p.lat]);
    const dist = turf.distance(pt, buoyPt, { units: 'kilometers' });
    return dist <= thresholdKm;
  });

  if (pointsInRange.length < 2) return null; // Not enough points near buoy

  // Calculate cumulative angle sweep
  let totalSweep = 0;
  for (let i = 1; i < pointsInRange.length; i++) {
    const p1 = pointsInRange[i - 1];
    const p2 = pointsInRange[i];
    
    // Angle from buoy to p1
    const angle1 = Math.atan2(p1.lat - buoy.coord[0], p1.lng - buoy.coord[1]);
    // Angle from buoy to p2
    const angle2 = Math.atan2(p2.lat - buoy.coord[0], p2.lng - buoy.coord[1]);
    
    let diff = angle2 - angle1;
    // Normalize to [-PI, PI]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    
    totalSweep += diff;
  }

  // Convert to degrees
  const sweepDeg = (totalSweep * 180) / Math.PI;
  
  // If the boat hasn't swept at least 90 degrees around the buoy, it hasn't completed rounding
  if (Math.abs(sweepDeg) < 90) return null;

  // Port rounding = counter-clockwise = positive sweep
  // Starboard rounding = clockwise = negative sweep
  if (buoy.rounding === 'port') {
    return sweepDeg > 0;
  } else if (buoy.rounding === 'starboard') {
    return sweepDeg < 0;
  }
  
  return false;
};
