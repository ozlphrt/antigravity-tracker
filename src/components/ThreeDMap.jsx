import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { Video } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';

// Helper functions for camera presets
function getCenterOfCoords(coords) {
  if (coords.length === 0) return [27.420, 37.015];
  let sumLng = 0, sumLat = 0;
  coords.forEach(([lng, lat]) => {
    sumLng += lng;
    sumLat += lat;
  });
  return [sumLng / coords.length, sumLat / coords.length];
}

function getMaxDistanceBetween(centerVal, coords) {
  let maxD = 0;
  const centerPt = turf.point(centerVal);
  coords.forEach(coord => {
    const d = turf.distance(centerPt, turf.point(coord), { units: 'kilometers' });
    if (d > maxD) maxD = d;
  });
  return maxD;
}

function getCheckpointMapCenter(cp) {
  if (!cp) return null;
  if (cp.coord) return [cp.coord[1], cp.coord[0]];
  if (cp.coords && cp.coords.length > 0) {
    const lat = cp.coords.reduce((sum, coord) => sum + coord[0], 0) / cp.coords.length;
    const lng = cp.coords.reduce((sum, coord) => sum + coord[1], 0) / cp.coords.length;
    return [lng, lat];
  }
  return null;
}

function getDynamicPadding(map, top, right, bottom, left) {
  const container = map.getContainer();
  const h = container.clientHeight || 600;
  const w = container.clientWidth || 800;
  return {
    top: Math.min(h * 0.15, top),
    right: Math.min(w * 0.15, right),
    bottom: Math.min(h * 0.40, bottom),
    left: Math.min(w * 0.15, left)
  };
}

function getBoundsCamera(map, coords, bearing, fallbackZoom = 16, options = {}) {
  const validCoords = (coords || [])
    .filter(coord => Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
  const pitch = options.pitch ?? CAMERA_PITCH;
  const maxZoom = options.maxZoom ?? CAMERA_MAX_ZOOM;
  const padding = options.padding || getDynamicPadding(map, 30, 30, 70, 30);

  if (validCoords.length === 0) return null;
  if (validCoords.length === 1) {
    return { center: validCoords[0], zoom: Math.min(fallbackZoom, maxZoom), bearing, pitch };
  }

  const bounds = new maplibregl.LngLatBounds(validCoords[0], validCoords[0]);
  validCoords.slice(1).forEach(coord => bounds.extend(coord));

  const camera = map.cameraForBounds(bounds, {
    bearing,
    pitch,
    maxZoom,
    padding
  });

  if (!camera || !camera.center) {
    const center = getCenterOfCoords(validCoords);
    const maxDist = getMaxDistanceBetween(center, validCoords);
    return {
      center,
      zoom: Math.max(14.2, Math.min(maxZoom, 17.8 - Math.log2(maxDist * 1000 + 1) * 0.75)),
      bearing,
      pitch
    };
  }

  return {
    center: [camera.center.lng, camera.center.lat],
    zoom: Math.min(camera.zoom, maxZoom),
    bearing,
    pitch
  };
}

function getFleetCamera(map, coords, bearing) {
  return getBoundsCamera(map, coords, bearing, 15.7, {
    pitch: CAMERA_PITCH,
    maxZoom: Math.min(CAMERA_MAX_ZOOM, 18.0),
    padding: getDynamicPadding(map, 36, 40, 90, 40)
  });
}

function getChaseCamera(boat, baseZoom, targetPos, targetName) {
  const boatPoint = turf.point([boat.lng, boat.lat]);
  const heading = boat.heading || 0;
  const lookAhead = turf.destination(boatPoint, 0.075, heading, { units: 'kilometers' }).geometry.coordinates;

  return {
    center: [
      boat.lng * 0.36 + lookAhead[0] * 0.64,
      boat.lat * 0.36 + lookAhead[1] * 0.64
    ],
    zoom: getFollowCameraZoom(baseZoom, boat, targetPos, targetName),
    bearing: heading,
    pitch: 76
  };
}

function smoothAngle(current, target, factor) {
  let diff = target - current;
  while (diff <= -180) diff += 360;
  while (diff > 180) diff -= 360;
  return (current + diff * factor + 360) % 360;
}

function moveCameraToward(map, camera, factor = 0.08) {
  const currentCenter = map.getCenter();
  const centerLng = currentCenter.lng + (camera.center[0] - currentCenter.lng) * factor;
  const centerLat = currentCenter.lat + (camera.center[1] - currentCenter.lat) * factor;
  const currentZoom = map.getZoom();
  const zoomVal = currentZoom + (camera.zoom - currentZoom) * 0.045;
  const currentBearing = map.getBearing();
  const bearingVal = camera.bearing === undefined ? currentBearing : smoothAngle(currentBearing, camera.bearing, 0.06);
  const currentPitch = map.getPitch();
  const pitchVal = currentPitch + ((camera.pitch ?? CAMERA_PITCH) - currentPitch) * 0.06;

  map.jumpTo({
    center: [centerLng, centerLat],
    zoom: zoomVal,
    bearing: bearingVal,
    pitch: pitchVal
  });
}

// Convert Hex to RGBA string for style expressions
function hexToRgba(hex, alpha) {
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  }
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeTrailData(points) {
  if (!points || points.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: points.map(p => [p.lng, p.lat])
      }
    }]
  };
}

function makeFleetTrailData(fleet, trailMap) {
  const colorById = Object.fromEntries((fleet || []).map(boat => [boat.id, boat.color || '#f43f5e']));
  const features = [];

  Object.entries(trailMap || {}).forEach(([id, points]) => {
    if (id === 'user' || !Array.isArray(points) || points.length < 2) return;
    const color = colorById[id] || '#f43f5e';

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const current = points[i];
      if (!prev || !current) continue;
      const progress = i / Math.max(points.length - 1, 1);
      const opacity = Math.pow(progress, 1.65);

      features.push({
        type: 'Feature',
        properties: {
          color,
          coreOpacity: 0.08 + opacity * 0.64,
          wakeOpacity: 0.02 + opacity * 0.22,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [prev.lng, prev.lat],
            [current.lng, current.lat]
          ]
        }
      });
    }
  });

  return { type: 'FeatureCollection', features };
}

function normalizeTrailPoints(points, maxPoints = 120) {
  return (points || [])
    .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .slice(-maxPoints)
    .map(p => ({ lat: p.lat, lng: p.lng }));
}

function makeUserPointsGeoJson(points) {
  if (!points || points.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features = points.map((p) => {
    return {
      type: 'Feature',
      properties: {
        opacity: 1.0
      },
      geometry: {
        type: 'Point',
        coordinates: [p.lng, p.lat]
      }
    };
  });

  return { type: 'FeatureCollection', features };
}

function seedRenderedTrail(trailRef, id, points, maxPoints = 120) {
  const normalized = normalizeTrailPoints(points, maxPoints);
  if (normalized.length < 2) return;

  const current = trailRef.current[id] || [];
  const currentLast = current[current.length - 1];
  const seedLast = normalized[normalized.length - 1];

  if (!currentLast) {
    trailRef.current[id] = normalized;
    return;
  }

  const gapMeters = turf.distance(
    turf.point([currentLast.lng, currentLast.lat]),
    turf.point([seedLast.lng, seedLast.lat]),
    { units: 'kilometers' }
  ) * 1000;

  if (gapMeters > 120 || current.length < 2) {
    trailRef.current[id] = normalized;
  }
}

function appendRenderedTrailPoint(trailRef, lastAppendRef, id, lng, lat, maxPoints = 170) {
  const now = performance.now();
  const lastAppend = lastAppendRef.current[id] || 0;
  const current = trailRef.current[id] || [];
  const last = current[current.length - 1];

  if (last) {
    const distanceMeters = turf.distance(
      turf.point([last.lng, last.lat]),
      turf.point([lng, lat]),
      { units: 'kilometers' }
    ) * 1000;

    if (distanceMeters > 120) {
      trailRef.current[id] = [{ lng, lat }];
      lastAppendRef.current[id] = now;
      return trailRef.current[id];
    }

    if (distanceMeters < 0.35 || now - lastAppend < 55) {
      return current;
    }
  }

  const next = [...current, { lng, lat }].slice(-maxPoints);
  trailRef.current[id] = next;
  lastAppendRef.current[id] = now;
  return next;
}

// Generate Canvas Boat Images for MapLibre WebGL Symbol Layer
function createBoatImage(color) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  
  // Exact scaled M12 2 L19 21 Q12 18 5 21 Z triangle from 2D Leaflet map
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(50, 56);
  ctx.quadraticCurveTo(32, 48, 14, 56);
  ctx.closePath();
  
  ctx.fill();
  ctx.stroke();
  
  // Get image data to satisfy MapLibre verification (expected width * height * 4 bytes)
  return ctx.getImageData(0, 0, size, size);
}

const SATELLITE_MAX_NATIVE_ZOOM = 17;
const CAMERA_PITCH = 70;
const LOW_CAMERA_PITCH = 64;
const CAMERA_CLOSE_ZOOM_BOOST = 3.95;
const CAMERA_MAX_ZOOM = 18.15;

const maplibreStyle = {
  version: 8,
  sources: {
    'satellite': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: SATELLITE_MAX_NATIVE_ZOOM
    }
  },
  layers: [
    {
      id: 'background-layer',
      type: 'background',
      paint: {
        'background-color': '#08101f' // Matches the dark sea blue theme under loading tiles
      }
    },
    {
      id: 'satellite-layer',
      type: 'raster',
      source: 'satellite',
      paint: {
        'raster-resampling': 'linear',
        'raster-fade-duration': 80
      }
    }
  ]
};

function getFollowCameraZoom(baseZoom, boat, targetPos, targetName) {
  let targetZoom = baseZoom + CAMERA_CLOSE_ZOOM_BOOST;

  if (boat && targetPos && targetPos[0] && targetPos[1] && targetName !== 'FINISHED') {
    const boatPt = turf.point([boat.lng, boat.lat]);
    const targetPt = turf.point([targetPos[1], targetPos[0]]);
    const distKm = turf.distance(boatPt, targetPt, { units: 'kilometers' });

    if (distKm < 0.4) {
      const factor = Math.max(0, Math.min(1, (0.4 - distKm) / 0.4));
      targetZoom += factor * 1.4;
    }
  }

  return Math.min(targetZoom, CAMERA_MAX_ZOOM);
}

export default function ThreeDMap({
  checkpoints = [],
  boatPos = null,
  fleet = [],
  trace = [],
  aiTrails = {},
  targetPos = null,
  targetName = '',
  center = [36.9758, 27.4601],
  zoom = 15.5,
  offlineQueue = [],
  syncingQueue = []
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const hasCenteredRef = useRef(false);
  const markersRef = useRef({}); // Store active HTML markers (buoys, endpoints, midpoints, boats)
  const lastCameraMoveRef = useRef(0);
  const lastGeoJsonUpdateRef = useRef(0);
  const geoJsonTimeoutRef = useRef(null);
  const programmaticCameraMoveRef = useRef(false);
  const [activePreset, setActivePreset] = useState('target');
  const activePresetRef = useRef('target');
  const lastAutoPresetRef = useRef('target');
  const overrideTimeoutRef = useRef(null);


 
  useEffect(() => {
    activePresetRef.current = activePreset;
    hasCenteredRef.current = false;
    if (activePreset !== 'manual') {
      lastAutoPresetRef.current = activePreset;
    }
  }, [activePreset]);

  const autoRotateAngleRef = useRef(0);

  const boatPosRef = useRef(boatPos);
  const fleetRef = useRef(fleet);
  const checkpointsRef = useRef(checkpoints);
  const targetPosRef = useRef(targetPos);
  const targetNameRef = useRef(targetName);
  const zoomRef = useRef(zoom);
  const animatedBoatsRef = useRef({});
  const isMapLoadedRef = useRef(false);
  const updateTelemetryRef = useRef(null);
  const userTrailPointsRef = useRef([]);
  const fleetTrailPointsRef = useRef({});
  const renderedTrailPointsRef = useRef({});
  const renderedTrailLastAppendRef = useRef({});

  useEffect(() => {
    boatPosRef.current = boatPos;
  }, [boatPos]);

  useEffect(() => {
    fleetRef.current = fleet;
  }, [fleet]);

  useEffect(() => {
    checkpointsRef.current = checkpoints;
    hasCenteredRef.current = false;
  }, [checkpoints]);

  useEffect(() => {
    targetPosRef.current = targetPos;
  }, [targetPos]);

  useEffect(() => {
    targetNameRef.current = targetName;
  }, [targetName]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // requestAnimationFrame loop to smoothly interpolate boat positions at 60 FPS (fixes stuttering)
  useEffect(() => {
    let frameId;
    const animate = () => {
      try {
        const map = mapRef.current;
        if (map && map.getSource('boats-source')) {
          const boatFeatures = [];
          let userAnim = null;
          const fleetAnimCoords = [];

          // 1. User Boat
          if (boatPosRef.current && boatPosRef.current.lat && boatPosRef.current.lng) {
            const id = 'user';
            let anim = animatedBoatsRef.current[id];
            const target = boatPosRef.current;
            
            if (!anim) {
              anim = { lat: target.lat, lng: target.lng, heading: target.heading || 0 };
            } else {
              anim.lat += (target.lat - anim.lat) * 0.15;
              anim.lng += (target.lng - anim.lng) * 0.15;
              
              let diff = (target.heading || 0) - anim.heading;
              while (diff <= -180) diff += 360;
              while (diff > 180) diff -= 360;
              anim.heading = (anim.heading + diff * 0.15 + 360) % 360;
            }
            animatedBoatsRef.current[id] = anim;
            userAnim = anim;

             // Real-time 60 FPS User Trail updates are no longer generated dynamically; we only show official saved/recorded points.

            boatFeatures.push({
              type: 'Feature',
              id: 0,
              properties: {
                name: 'YOU',
                icon: 'boat-user',
                heading: anim.heading
              },
              geometry: {
                type: 'Point',
                coordinates: [anim.lng, anim.lat]
              }
            });

            if (map.getSource('user-boat-pulse')) {
              map.getSource('user-boat-pulse').setData({
                type: 'FeatureCollection',
                features: [{
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [anim.lng, anim.lat]
                  }
                }]
              });
            }
          }

          // 2. Fleet Boats
          fleetRef.current.forEach((boat, index) => {
            const lat = boat.lat || boat.pos?.lat;
            const lng = boat.lng || boat.pos?.lng;
            if (!lat || !lng) return;

            const id = boat.id;
            let anim = animatedBoatsRef.current[id];
            const target = { lat, lng, heading: boat.heading || 0 };

            if (!anim) {
              anim = { lat: target.lat, lng: target.lng, heading: target.heading };
            } else {
              anim.lat += (target.lat - anim.lat) * 0.15;
              anim.lng += (target.lng - anim.lng) * 0.15;

              let diff = target.heading - anim.heading;
              while (diff <= -180) diff += 360;
              while (diff > 180) diff -= 360;
              anim.heading = (anim.heading + diff * 0.15 + 360) % 360;
            }
            animatedBoatsRef.current[id] = anim;
            fleetAnimCoords.push([anim.lng, anim.lat]);

            const colorHex = (boat.color || '#f43f5e').replace('#', '');
            const iconName = `boat-fleet-${colorHex}`;

            // Real-time 60 FPS AI Trail updates matching the smooth boat coordinates
            const trailSource = map.getSource(`trail-source-${id}`);
            if (trailSource) {
              const visualTrail = appendRenderedTrailPoint(
                renderedTrailPointsRef,
                renderedTrailLastAppendRef,
                id,
                anim.lng,
                anim.lat,
                145
              );
              trailSource.setData(makeTrailData(visualTrail));
            }

            boatFeatures.push({
              type: 'Feature',
              id: index + 1,
              properties: {
                name: boat.name?.toUpperCase() || 'BOAT',
                icon: iconName,
                heading: anim.heading
              },
              geometry: {
                type: 'Point',
                coordinates: [anim.lng, anim.lat]
              }
            });
          });

          const fleetTrailsSource = map.getSource('fleet-trails-source');
          if (fleetTrailsSource) {
            fleetTrailsSource.setData(makeFleetTrailData(fleetRef.current, renderedTrailPointsRef.current));
          }

          if (userAnim) {
            const activePresetId = activePresetRef.current;
            let camera = null;

            if (activePresetId === 'follow') {
              camera = getChaseCamera(userAnim, zoomRef.current, targetPosRef.current, targetNameRef.current);
            } else if (activePresetId === 'all-boats') {
              const coords = [[userAnim.lng, userAnim.lat], ...fleetAnimCoords];
              camera = getFleetCamera(map, coords, userAnim.heading || 0);
            } else if (activePresetId === 'target' && targetPosRef.current && targetPosRef.current[0]) {
              const targetLng = targetPosRef.current[1];
              const targetLat = targetPosRef.current[0];
              const targetPt = turf.point([targetLng, targetLat]);
              const boatPt = turf.point([userAnim.lng, userAnim.lat]);
              camera = getBoundsCamera(
                map,
                [[userAnim.lng, userAnim.lat], [targetLng, targetLat]],
                turf.bearing(targetPt, boatPt),
                17.0,
                {
                  pitch: LOW_CAMERA_PITCH,
                  maxZoom: CAMERA_MAX_ZOOM,
                  padding: getDynamicPadding(map, 16, 20, 60, 20)
                }
              );
            } else if (activePresetId === 'last-target') {
              const currentTargetName = (targetNameRef.current || '').toUpperCase();
              const targetIdx = checkpointsRef.current.findIndex(cp => cp.id?.toUpperCase() === currentTargetName);
              const lastCp = targetIdx > 0
                ? checkpointsRef.current[targetIdx - 1]
                : checkpointsRef.current.find(cp => cp.kind === 'start');
              const lastCenter = getCheckpointMapCenter(lastCp);
              if (lastCenter) {
                const lastPt = turf.point(lastCenter);
                const boatPt = turf.point([userAnim.lng, userAnim.lat]);
                camera = getBoundsCamera(
                  map,
                  [[userAnim.lng, userAnim.lat], lastCenter],
                  turf.bearing(lastPt, boatPt),
                  17.0,
                  {
                    pitch: LOW_CAMERA_PITCH,
                    maxZoom: CAMERA_MAX_ZOOM,
                    padding: getDynamicPadding(map, 16, 20, 60, 20)
                  }
                );
              }
            } else if (activePresetId === 'auto-rotate') {
              autoRotateAngleRef.current = (autoRotateAngleRef.current + 0.15) % 360;
              const coords = [[userAnim.lng, userAnim.lat], ...fleetAnimCoords];
              camera = getFleetCamera(map, coords, autoRotateAngleRef.current);
            }

            if (camera) {
              programmaticCameraMoveRef.current = true;
              if (!hasCenteredRef.current) {
                map.jumpTo({
                  center: camera.center,
                  zoom: camera.zoom,
                  bearing: camera.bearing,
                  pitch: camera.pitch ?? CAMERA_PITCH
                });
                hasCenteredRef.current = true;
              } else {
                moveCameraToward(map, camera);
              }
              window.setTimeout(() => {
                programmaticCameraMoveRef.current = false;
              }, 0);
            }
          }

          if (map.getSource('boats-source')) {
            map.getSource('boats-source').setData({
              type: 'FeatureCollection',
              features: boatFeatures
            });
          }
        }
      } catch (err) {
        console.error("Error in animation frame:", err);
      } finally {
        frameId = requestAnimationFrame(animate);
      }
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const mapCenter = [center[1], center[0]];

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: maplibreStyle,
      center: mapCenter,
      zoom: Math.min(zoom + CAMERA_CLOSE_ZOOM_BOOST, CAMERA_MAX_ZOOM),
      pitch: CAMERA_PITCH,
      maxPitch: 80,
      maxZoom: CAMERA_MAX_ZOOM,
      bearing: -15,
      antialias: true,
      fadeDuration: 100, // Speed up tile fade-in duration
      maxTileCacheSize: 120 // Cache more tiles in memory to prevent re-downloads
    });

    mapRef.current = map;

    map.on('styleimagemissing', (e) => {
      const id = e.id;
      if (id === 'boat-user') {
        map.addImage('boat-user', createBoatImage('#FF5D00'));
      } else if (id.startsWith('boat-fleet-')) {
        const hex = id.replace('boat-fleet-', '');
        map.addImage(id, createBoatImage(`#${hex}`));
      }
    });

    map.on('load', () => {
      isMapLoadedRef.current = true;
      map.setPitch(CAMERA_PITCH);

      map.addSource('course-lines', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addSource('user-boat-pulse', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'user-boat-pulse-layer',
        type: 'circle',
        source: 'user-boat-pulse',
        paint: {
          'circle-color': '#06b6d4',
          'circle-radius': 18,
          'circle-blur': 0.8,
          'circle-opacity': 0.6,
          'circle-pitch-alignment': 'map'
        }
      });

      map.addSource('boats-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      
      map.addLayer({
        id: 'boats-layer',
        type: 'symbol',
        source: 'boats-source',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-rotate': ['get', 'heading'],
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 0.15,
            14, 0.35,
            18, 0.6,
            21, 1.0
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-offset': [0, 2.8],
          'text-anchor': 'top',
          'text-pitch-alignment': 'map',
          'text-rotation-alignment': 'viewport',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-optional': true
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0f172a',
          'text-halo-width': 2,
          'text-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false], 1, 
            0 
          ]
        }
      });

      map.addSource('fleet-trails-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'fleet-trails-wake-layer',
        type: 'line',
        source: 'fleet-trails-source',
        paint: {
          'line-color': '#ffffff',
          'line-width': 10,
          'line-blur': 5,
          'line-opacity': ['get', 'wakeOpacity']
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      }, 'boats-layer');

      map.addLayer({
        id: 'fleet-trails-core-layer',
        type: 'line',
        source: 'fleet-trails-source',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2.7,
          'line-opacity': ['get', 'coreOpacity']
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      }, 'boats-layer');

      let hoveredBoatId = null;
      map.on('mousemove', 'boats-layer', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) {
          if (hoveredBoatId !== null) {
            map.setFeatureState({ source: 'boats-source', id: hoveredBoatId }, { hover: false });
          }
          hoveredBoatId = e.features[0].id;
          map.setFeatureState({ source: 'boats-source', id: hoveredBoatId }, { hover: true });
        }
      });
      
      map.on('mouseleave', 'boats-layer', () => {
        map.getCanvas().style.cursor = '';
        if (hoveredBoatId !== null) {
          map.setFeatureState({ source: 'boats-source', id: hoveredBoatId }, { hover: false });
          hoveredBoatId = null;
        }
      });

      // Subtle dotted course line style (using round caps with short dash and gap)
      map.addLayer({
        id: 'course-connection-layer',
        type: 'line',
        source: 'course-lines',
        paint: {
          'line-color': '#06b6d4',
          'line-width': 3,
          'line-dasharray': [0.15, 3],
          'line-opacity': 0.22
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      });

      map.addSource('checkpoint-gates', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Dual-layer gate/lines (border + fill) to match the 2D Leaflet pill style
      map.addLayer({
        id: 'checkpoint-gates-border-layer',
        type: 'line',
        source: 'checkpoint-gates',
        paint: {
          'line-color': ['get', 'borderColor'],
          'line-width': 14,
          'line-opacity': ['get', 'opacity']
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      });

      map.addLayer({
        id: 'checkpoint-gates-layer',
        type: 'line',
        source: 'checkpoint-gates',
        paint: {
          'line-color': ['get', 'fillColor'],
          'line-width': 8,
          'line-opacity': ['get', 'opacity']
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      });

      map.addSource('telemetry-heading', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addSource('telemetry-bearing', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'telemetry-heading-layer',
        type: 'line',
        source: 'telemetry-heading',
        paint: {
          'line-color': '#FF5D00',
          'line-width': 2.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.75
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      });

      map.addLayer({
        id: 'telemetry-bearing-layer',
        type: 'line',
        source: 'telemetry-bearing',
        paint: {
          'line-color': '#f26419',
          'line-width': 2.5,
          'line-dasharray': [0, 3],
          'line-opacity': 0.65
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      });
    });

    map.addControl(new maplibregl.NavigationControl({
      showCompass: true,
      visualizePitch: true
    }));

    const clearPreset = (e) => {
      if (e && e.originalEvent) {
        if (activePresetRef.current !== 'manual') {
          lastAutoPresetRef.current = activePresetRef.current;
        }
        setActivePreset('manual');

        if (overrideTimeoutRef.current) {
          clearTimeout(overrideTimeoutRef.current);
        }
        overrideTimeoutRef.current = setTimeout(() => {
          if (activePresetRef.current === 'manual' && lastAutoPresetRef.current && lastAutoPresetRef.current !== 'manual') {
            setActivePreset(lastAutoPresetRef.current);
          }
        }, 6000); // 6s of inactivity reverts camera tracking back
      }
    };
    map.on('dragstart', clearPreset);
    map.on('zoomstart', clearPreset);
    map.on('pitchstart', clearPreset);
    map.on('rotatestart', clearPreset);

    return () => {
      if (overrideTimeoutRef.current) {
        clearTimeout(overrideTimeoutRef.current);
      }
      Object.values(markersRef.current).forEach(m => m.remove());
      markersRef.current = {};
      map.off('dragstart', clearPreset);
      map.off('zoomstart', clearPreset);
      map.off('pitchstart', clearPreset);
      map.off('rotatestart', clearPreset);
      map.remove();
    };
  }, []);

  // Effect 1: Update Static Course GeoJSON sources (Depends only on checkpoints layout)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateStaticLayers = () => {
      if (!map.getSource('course-lines') || !map.getSource('checkpoint-gates')) return;

      const connectionCoordinates = checkpoints
        .map(cp => {
          if (cp.kind === 'buoy' && cp.coord) {
            return [cp.coord[1], cp.coord[0]];
          } else if (cp.coords) {
            const midLat = (cp.coords[0][0] + cp.coords[1][0]) / 2;
            const midLng = (cp.coords[0][1] + cp.coords[1][1]) / 2;
            return [midLng, midLat];
          }
          return null;
        })
        .filter(Boolean);

      map.getSource('course-lines').setData({
        type: 'FeatureCollection',
        features: connectionCoordinates.length > 1 ? [{
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: connectionCoordinates
          }
        }] : []
      });

      const activeTargetName = (targetName || '').toUpperCase();
      const gateFeatures = checkpoints
        .filter(cp => cp.kind !== 'buoy' && cp.coords)
        .map(cp => {
          const isTarget = cp.id?.toUpperCase() === activeTargetName;
          const fillColor = cp.kind === 'start' ? '#22c55e'
            : cp.kind === 'finish' ? '#ef4444' : '#f5cb5c';
          const borderColor = cp.kind === 'start' ? '#166534'
            : cp.kind === 'finish' ? '#991b1b' : '#b7791f';

          return {
            type: 'Feature',
            properties: {
              fillColor,
              borderColor,
              opacity: isTarget ? 0.95 : 0.16
            },
            geometry: {
              type: 'LineString',
              coordinates: [
                [cp.coords[0][1], cp.coords[0][0]],
                [cp.coords[1][1], cp.coords[1][0]]
              ]
            }
          };
        });

      map.getSource('checkpoint-gates').setData({
        type: 'FeatureCollection',
        features: gateFeatures
      });
    };

    if (isMapLoadedRef.current) {
      updateStaticLayers();
    } else {
      map.on('load', updateStaticLayers);
    }
  }, [checkpoints, targetName]);
  // Setup dynamic trail sources/layers for each boat (gradient trails redesigned from scratch)
  // Setup dynamic trail sources/layers for each boat (gradient trails redesigned from scratch)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const setupLayers = () => {
      const boatIds = ['user', ...fleet.map(b => b.id)];
      const beforeLayerId = map.getLayer('boats-layer') ? 'boats-layer' : undefined;

      boatIds.forEach(id => {
        const sourceId = `trail-source-${id}`;
        const wakeLayerId = `trail-layer-${id}-wake`;
        const coreLayerId = `trail-layer-${id}-core`;

        if (id === 'user') {
          // Explicitly remove stale wake/core layers from previous versions/mounts
          if (map.getLayer('trail-layer-user-wake')) map.removeLayer('trail-layer-user-wake');
          if (map.getLayer('trail-layer-user-core')) map.removeLayer('trail-layer-user-core');

          if (!map.getSource('trail-source-user')) {
            map.addSource('trail-source-user', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] }
            });
          }
          if (!map.getSource('trail-source-user-line')) {
            map.addSource('trail-source-user-line', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] }
            });
          }

          if (!map.getLayer('trail-layer-user-line') && map.getSource('trail-source-user-line')) {
            // A. Faint connecting line underneath circles (solid 100% visible orange)
            map.addLayer({
              id: 'trail-layer-user-line',
              type: 'line',
              source: 'trail-source-user-line',
              paint: {
                'line-width': 1.8,
                'line-opacity': 0.85,
                'line-color': '#FF5D00'
              },
              layout: {
                'line-cap': 'round',
                'line-join': 'round'
              }
            }, beforeLayerId);
          }

          if (!map.getLayer('trail-layer-user-circles') && map.getSource('trail-source-user')) {
            // B. Data collection circles on top
            map.addLayer({
              id: 'trail-layer-user-circles',
              type: 'circle',
              source: 'trail-source-user',
              paint: {
                'circle-radius': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10, 1.2,
                  15, 2.2,
                  18, 3.5,
                  21, 6.0
                ],
                'circle-color': '#FF5D00',
                'circle-opacity': ['get', 'opacity'],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': ['get', 'opacity'],
                'circle-pitch-alignment': 'map'
              }
            }, beforeLayerId);
          }

          // C. Setup syncing queue layers (Yellow)
          if (!map.getSource('trail-source-user-sync')) {
            map.addSource('trail-source-user-sync', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          }
          if (!map.getSource('trail-source-user-sync-line')) {
            map.addSource('trail-source-user-sync-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          }
          if (!map.getLayer('trail-layer-user-sync-line') && map.getSource('trail-source-user-sync-line')) {
            map.addLayer({
              id: 'trail-layer-user-sync-line',
              type: 'line',
              source: 'trail-source-user-sync-line',
              paint: {
                'line-width': 1.8,
                'line-opacity': 0.85,
                'line-color': '#EAB308'
              },
              layout: {
                'line-cap': 'round',
                'line-join': 'round'
              }
            }, beforeLayerId);
          }
          if (!map.getLayer('trail-layer-user-sync-circles') && map.getSource('trail-source-user-sync')) {
            map.addLayer({
              id: 'trail-layer-user-sync-circles',
              type: 'circle',
              source: 'trail-source-user-sync',
              paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 2.2, 18, 3.5, 21, 6.0],
                'circle-color': '#EAB308',
                'circle-opacity': ['get', 'opacity'],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': ['get', 'opacity'],
                'circle-pitch-alignment': 'map'
              }
            }, beforeLayerId);
          }

          // D. Setup offline queue layers (Red)
          if (!map.getSource('trail-source-user-off')) {
            map.addSource('trail-source-user-off', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          }
          if (!map.getSource('trail-source-user-off-line')) {
            map.addSource('trail-source-user-off-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          }
          if (!map.getLayer('trail-layer-user-off-line') && map.getSource('trail-source-user-off-line')) {
            map.addLayer({
              id: 'trail-layer-user-off-line',
              type: 'line',
              source: 'trail-source-user-off-line',
              paint: {
                'line-width': 1.8,
                'line-opacity': 0.85,
                'line-color': '#EF4444'
              },
              layout: {
                'line-cap': 'round',
                'line-join': 'round'
              }
            }, beforeLayerId);
          }
          if (!map.getLayer('trail-layer-user-off-circles') && map.getSource('trail-source-user-off')) {
            map.addLayer({
              id: 'trail-layer-user-off-circles',
              type: 'circle',
              source: 'trail-source-user-off',
              paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 2.2, 18, 3.5, 21, 6.0],
                'circle-color': '#EF4444',
                'circle-opacity': ['get', 'opacity'],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': ['get', 'opacity'],
                'circle-pitch-alignment': 'map'
              }
            }, beforeLayerId);
          }


        } else {
          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
              type: 'geojson',
              lineMetrics: true, // required for line-gradient
              data: { type: 'FeatureCollection', features: [] }
            });

            const rawColor = id === 'user' ? '#FF5D00' : (fleet.find(b => b.id === id)?.color || '#f43f5e');

            // 1. Wake layer (fuzzy white-blue foam wake)
            map.addLayer({
              id: wakeLayerId,
              type: 'line',
              source: sourceId,
              paint: {
                'line-width': 15,
                'line-opacity': 0.34,
                'line-blur': 6,
                'line-gradient': [
                  'interpolate',
                  ['linear'],
                  ['line-progress'],
                  0, 'rgba(224, 242, 254, 0)',
                  0.45, 'rgba(224, 242, 254, 0.08)',
                  0.82, 'rgba(255, 255, 255, 0.2)',
                  1, 'rgba(255, 255, 255, 0.42)'
                ]
              },
              layout: {
                'line-cap': 'round',
                'line-join': 'round'
              }
            }, beforeLayerId);

          // 2. Core path layer (sharp fading color trail)
          map.addLayer({
            id: coreLayerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-width': 3.2,
              'line-opacity': 0.82,
              'line-gradient': [
                'interpolate',
                ['linear'],
                ['line-progress'],
                0, 'rgba(255, 255, 255, 0)',
                0.35, hexToRgba(rawColor, 0.14),
                0.82, hexToRgba(rawColor, 0.62),
                1, rawColor
              ]
            },
            layout: {
              'line-cap': 'round',
              'line-join': 'round'
            }
          }, beforeLayerId);
        }
      }
    });
    };

    if (isMapLoadedRef.current) {
      setupLayers();
      if (updateTelemetryRef.current) updateTelemetryRef.current();
    } else {
      map.on('load', () => {
        setupLayers();
        if (updateTelemetryRef.current) updateTelemetryRef.current();
      });
    }
  }, [fleet]);

  // Effect 3: Update Telemetry & dynamic Trail GeoJSON sources
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateTelemetryLayers = () => {
      // 1. Update User Trail (Draw all recorded/saved dots connected by lines)
      userTrailPointsRef.current = [...trace];
      const userTrailSource = map.getSource('trail-source-user');
      const userLineSource = map.getSource('trail-source-user-line');
      if (trace && trace.length >= 2) {
        if (userTrailSource) userTrailSource.setData(makeUserPointsGeoJson(trace));
        if (userLineSource) userLineSource.setData(makeTrailData(trace));
      }

      // 1B. Update User Syncing/Offline buffered trails
      const userSyncSource = map.getSource('trail-source-user-sync');
      const userSyncLineSource = map.getSource('trail-source-user-sync-line');
      const userOffSource = map.getSource('trail-source-user-off');
      const userOffLineSource = map.getSource('trail-source-user-off-line');

      if (userSyncSource || userSyncLineSource) {
        const syncPoints = syncingQueue || [];
        const syncLinePoints = (trace && trace.length > 0 && syncPoints.length > 0)
          ? [trace[trace.length - 1], ...syncPoints]
          : syncPoints;
        if (userSyncSource) userSyncSource.setData(makeUserPointsGeoJson(syncPoints));
        if (userSyncLineSource) userSyncLineSource.setData(makeTrailData(syncLinePoints));
      }

      if (userOffSource || userOffLineSource) {
        const offPoints = offlineQueue || [];
        let offLinePoints = offPoints;
        if (offPoints.length > 0) {
          const basePoint = (syncingQueue && syncingQueue.length > 0)
            ? syncingQueue[syncingQueue.length - 1]
            : (trace && trace.length > 0 ? trace[trace.length - 1] : null);
          if (basePoint) {
            offLinePoints = [basePoint, ...offPoints];
          }
        }
        if (userOffSource) userOffSource.setData(makeUserPointsGeoJson(offPoints));
        if (userOffLineSource) userOffLineSource.setData(makeTrailData(offLinePoints));
      }

      // 2. Save AI Trails points to ref
      if (aiTrails) {
        Object.entries(aiTrails).forEach(([boatId, points]) => {
          fleetTrailPointsRef.current[boatId] = points;
          seedRenderedTrail(renderedTrailPointsRef, boatId, points, 95);
          const trailSource = map.getSource(`trail-source-${boatId}`);
          if (trailSource && renderedTrailPointsRef.current[boatId] && renderedTrailPointsRef.current[boatId].length >= 2) {
            trailSource.setData(makeTrailData(renderedTrailPointsRef.current[boatId]));
          }
        });

        const fleetTrailsSource = map.getSource('fleet-trails-source');
        if (fleetTrailsSource) {
          fleetTrailsSource.setData(makeFleetTrailData(fleet, renderedTrailPointsRef.current));
        }
      }

      // 3. Telemetry lines
      if (boatPos && boatPos.lat && boatPos.lng && map.getSource('telemetry-heading') && map.getSource('telemetry-bearing')) {
        const userPt = turf.point([boatPos.lng, boatPos.lat]);
        const heading = boatPos.heading || 0;
        const dest = turf.destination(userPt, 1.0, heading, { units: 'kilometers' }).geometry.coordinates;

        map.getSource('telemetry-heading').setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [boatPos.lng, boatPos.lat],
                [dest[0], dest[1]]
              ]
            }
          }]
        });

        if (targetPos && targetPos[0] && targetPos[1] && targetName !== 'FINISHED') {
          map.getSource('telemetry-bearing').setData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [boatPos.lng, boatPos.lat],
                  [targetPos[1], targetPos[0]]
                ]
              }
            }]
          });
        } else {
          map.getSource('telemetry-bearing').setData({
            type: 'FeatureCollection',
            features: []
          });
        }
      } else {
        if (map.getSource('telemetry-heading')) {
          map.getSource('telemetry-heading').setData({ type: 'FeatureCollection', features: [] });
        }
        if (map.getSource('telemetry-bearing')) {
          map.getSource('telemetry-bearing').setData({ type: 'FeatureCollection', features: [] });
        }
      }
    };

    updateTelemetryRef.current = updateTelemetryLayers;

    const now = Date.now();
    const timeSinceLastUpdate = now - lastGeoJsonUpdateRef.current;

    const performUpdate = () => {
      if (isMapLoadedRef.current) {
        updateTelemetryLayers();
      } else {
        map.on('load', updateTelemetryLayers);
      }
      lastGeoJsonUpdateRef.current = Date.now();
      if (geoJsonTimeoutRef.current) {
        clearTimeout(geoJsonTimeoutRef.current);
        geoJsonTimeoutRef.current = null;
      }
    };

    if (timeSinceLastUpdate >= 65) {
      performUpdate();
    } else {
      if (geoJsonTimeoutRef.current) clearTimeout(geoJsonTimeoutRef.current);
      geoJsonTimeoutRef.current = setTimeout(performUpdate, 65 - timeSinceLastUpdate);
    }

    return () => {
      updateTelemetryRef.current = null;
      if (geoJsonTimeoutRef.current) {
        clearTimeout(geoJsonTimeoutRef.current);
      }
    };
  }, [trace, aiTrails, boatPos, fleet, targetPos, targetName, offlineQueue, syncingQueue]);



  // Effect 4: Update Checkpoint HTML Markers (Runs ONLY when checkpoints layout or targetName changes)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const newMarkers = {};

    // 1. Render Buoys
    checkpoints.forEach(cp => {
      if (cp.kind !== 'buoy' || !cp.coord) return;
      
      const isTarget = cp.id.toUpperCase() === targetName.toUpperCase();
      const isPort = (cp.rounding || 'port').toLowerCase() === 'port';
      const ringColor = isTarget ? '#f26419' : (isPort ? '#ef4444' : '#22c55e');
      const speed = isTarget ? '3.5s' : '5s';
      const markerOpacity = isTarget ? 1 : 0.22;
      const animName = `spin-${cp.id}`;
      const svgPath = isPort 
        ? `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>` 
        : `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`;

      const flatKey = `buoy-flat-${cp.id}`;
      let flatMarker = markersRef.current[flatKey];
      if (!flatMarker) {
        const el = document.createElement('div');
        el.style.width = '64px';
        el.style.height = '64px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.willChange = 'transform';
        el.style.opacity = markerOpacity;
        el.innerHTML = `
          <style>
            @keyframes ${animName}-kf {
              from { transform: rotate(0deg); }
              to { transform: rotate(${isPort ? '-360deg' : '360deg'}); }
            }
          </style>
          <div style="position: relative; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 3px 5px rgba(0,0,0,0.45));">
            <div style="width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; animation: ${animName}-kf ${speed} linear infinite;">
              <svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="${ringColor}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                ${svgPath}
              </svg>
            </div>
            <div style="position: absolute; background: white; color: var(--text-primary); border: 2.5px solid ${ringColor}; border-radius: 50%; font-weight: 950; font-size: 13px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; box-shadow: 0 1.5px 3px rgba(0,0,0,0.3);">${cp.id.replace(/\D/g, '')}</div>
          </div>
        `;

        flatMarker = new maplibregl.Marker({
          element: el,
          rotationAlignment: 'map',
          pitchAlignment: 'map'
        })
          .setLngLat([cp.coord[1], cp.coord[0]])
          .addTo(map);
      } else {
        flatMarker.setLngLat([cp.coord[1], cp.coord[0]]);
        flatMarker.getElement().style.opacity = markerOpacity;
      }
      newMarkers[flatKey] = flatMarker;
      delete markersRef.current[flatKey];
    });

    // 2. Render Line Endpoints and Midpoint Crossing Arrows
    checkpoints.forEach(cp => {
      if (cp.kind === 'buoy' || !cp.coords) return;
      const isTarget = cp.id?.toUpperCase() === targetName.toUpperCase();
      const markerOpacity = isTarget ? 0.95 : 0.16;
      const color = cp.kind === 'start' ? '#22c55e'
        : cp.kind === 'finish' ? '#ef4444' : '#f5cb5c';

      // A. Endpoint buoys (flat perspective)
      cp.coords.forEach((coord, idx) => {
        const key = `line-endpoint-${cp.id}-${idx}`;
        let marker = markersRef.current[key];
        if (!marker) {
          const el = document.createElement('div');
          el.style.width = '24px';
          el.style.height = '24px';
          el.style.display = 'flex';
          el.style.alignItems = 'center';
          el.style.justifyContent = 'center';
          el.style.willChange = 'transform';
          el.style.opacity = markerOpacity;
          el.innerHTML = `
            <div class="line-endpoint-inner" style="
              width: 18px; 
              height: 18px; 
              border-radius: 50%; 
              background: radial-gradient(circle at 6px 6px, ${color}, #1e293b); 
              box-shadow: 0 3px 6px rgba(0,0,0,0.5);
              border: 2px solid white;
              opacity: ${isTarget ? 1.0 : 0.55};
            "></div>
          `;
          marker = new maplibregl.Marker({
            element: el,
            rotationAlignment: 'map',
            pitchAlignment: 'map'
          })
            .setLngLat([coord[1], coord[0]])
            .addTo(map);
        } else {
          marker.setLngLat([coord[1], coord[0]]);
          marker.getElement().style.opacity = markerOpacity;
          const inner = marker.getElement().querySelector('.line-endpoint-inner');
          if (inner) {
            inner.style.opacity = isTarget ? '1.0' : '0.55';
          }
        }
        newMarkers[key] = marker;
        delete markersRef.current[key];
      });

      // B. Flat MULTI-ARROW sliding crossing indicators at midpoint oriented in crossing bearing
      const midLat = (cp.coords[0][0] + cp.coords[1][0]) / 2;
      const midLng = (cp.coords[0][1] + cp.coords[1][1]) / 2;

      const ptA = turf.point([cp.coords[0][1], cp.coords[0][0]]);
      const ptB = turf.point([cp.coords[1][1], cp.coords[1][0]]);
      const lb = turf.bearing(ptA, ptB);
      
      const crossingDir = cp.crossing || 'up';
      const crossingBearing = crossingDir === 'up' 
        ? (lb - 90 + 360) % 360 
        : (lb + 90 + 360) % 360;

      const midKey = `line-midpoint-${cp.id}`;
      let midMarker = markersRef.current[midKey];
      if (!midMarker) {
        const el = document.createElement('div');
        el.style.width = '120px';
        el.style.height = '48px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.willChange = 'transform';
        el.style.opacity = markerOpacity;
        el.innerHTML = `
          <style>
            @keyframes arrow-slide-${cp.id} {
              0% { transform: translateY(14px); opacity: 0; }
              15% { opacity: 0.85; }
              85% { opacity: 0.85; }
              100% { transform: translateY(-14px); opacity: 0; }
            }
          </style>
          <div style="position: relative; width: 100%; height: 100%; display: flex; justify-content: space-around; align-items: center; pointer-events: none;">
            ${[0, 1, 2].map(i => {
              const delay = (i * 0.28).toFixed(2);
              return `
                <div style="animation: arrow-slide-${cp.id} 1.4s linear infinite; animation-delay: ${delay}s; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.45)); display: flex; align-items: center; justify-content: center;">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </div>
              `;
            }).join('')}
          </div>
        `;
        midMarker = new maplibregl.Marker({
          element: el,
          rotationAlignment: 'map',
          pitchAlignment: 'map'
        })
          .setLngLat([midLng, midLat])
          .setRotation(crossingBearing)
          .addTo(map);
      } else {
        midMarker.setLngLat([midLng, midLat]);
        midMarker.setRotation(crossingBearing);
        midMarker.getElement().style.opacity = markerOpacity;
      }
      newMarkers[midKey] = midMarker;
      delete markersRef.current[midKey];
    });

    // Clean up old checkpoint markers and preserve boats
    Object.keys(markersRef.current).forEach(key => {
      if (key.startsWith('buoy-') || key.startsWith('line-')) {
        markersRef.current[key].remove();
        delete markersRef.current[key];
      }
    });

    // Merge new checkpoint markers into store
    Object.assign(markersRef.current, newMarkers);
  }, [checkpoints, targetName]);

  const cameraPresets = [
    { id: 'follow', label: 'Chase', desc: 'Follow from behind the user boat' },
    { id: 'all-boats', label: 'Fleet', desc: 'Keep all boats in view' },
    { id: 'target', label: 'Target', desc: 'Look from the target buoy', disabled: !targetPos || !targetPos[0] },
    { id: 'last-target', label: 'Previous', desc: 'Look from the last target' },
    { id: 'auto-rotate', label: 'Rotate', desc: 'Orbit the fleet' }
  ];
  const availableCameraPresets = cameraPresets.filter(preset => !preset.disabled);
  const activeCameraPreset = cameraPresets.find(preset => preset.id === activePreset) || cameraPresets[0];
  const cycleCameraPreset = () => {
    const currentIndex = availableCameraPresets.findIndex(preset => preset.id === activePreset);
    const nextPreset = availableCameraPresets[(currentIndex + 1) % availableCameraPresets.length] || availableCameraPresets[0];
    if (nextPreset) {
      if (overrideTimeoutRef.current) {
        clearTimeout(overrideTimeoutRef.current);
        overrideTimeoutRef.current = null;
      }
      lastAutoPresetRef.current = nextPreset.id;
      setActivePreset(nextPreset.id);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div 
        ref={mapContainerRef} 
        className="td-map-container"
        style={{ width: '100%', height: '100%' }} 
      />
      
      <button
        type="button"
        title={`${activeCameraPreset.desc}. Tap to cycle camera preset.`}
        onClick={cycleCameraPreset}
        style={{
          position: 'absolute',
          left: '118px',
          top: '10px',
          zIndex: 1001,
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: '16px',
          padding: '3px 12px 3px 3px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: 'var(--text-primary)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          cursor: 'pointer',
          height: '32px',
          fontFamily: 'inherit',
          outline: 'none',
          boxSizing: 'border-box'
        }}
      >
        <div style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          backgroundColor: 'var(--accent-blue)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff'
        }}>
          <Video size={12} strokeWidth={2.8} />
        </div>
        <span style={{
          fontWeight: 700,
          fontSize: '0.78rem',
          lineHeight: 1,
          color: 'var(--text-primary)'
        }}>
          {activePreset === 'manual' ? 'Manual Cam' : activeCameraPreset.label}
        </span>
      </button>
    </div>
  );
}
