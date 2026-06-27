import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
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

const maplibreStyle = {
  version: 8,
  sources: {
    'satellite': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19
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
      source: 'satellite'
    }
  ]
};

export default function ThreeDMap({
  checkpoints = [],
  boatPos = null,
  fleet = [],
  trace = [],
  aiTrails = {},
  targetPos = null,
  targetName = '',
  center = [36.9758, 27.4601],
  zoom = 15.5
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({}); // Store active HTML markers (buoys, endpoints, midpoints, boats)
  const lastCameraMoveRef = useRef(0);
  const lastGeoJsonUpdateRef = useRef(0);
  const geoJsonTimeoutRef = useRef(null);
  const [activePreset, setActivePreset] = useState('follow');
  const activePresetRef = useRef('follow');

  useEffect(() => {
    activePresetRef.current = activePreset;
  }, [activePreset]);

  const autoRotateAngleRef = useRef(0);

  const boatPosRef = useRef(boatPos);
  const fleetRef = useRef(fleet);
  const animatedBoatsRef = useRef({});
  const isMapLoadedRef = useRef(false);
  const updateTelemetryRef = useRef(null);
  const userTrailPointsRef = useRef([]);
  const fleetTrailPointsRef = useRef({});

  useEffect(() => {
    boatPosRef.current = boatPos;
  }, [boatPos]);

  useEffect(() => {
    fleetRef.current = fleet;
  }, [fleet]);

  // requestAnimationFrame loop to smoothly interpolate boat positions at 60 FPS (fixes stuttering)
  useEffect(() => {
    let frameId;
    const animate = () => {
      try {
        const map = mapRef.current;
        if (map && map.getSource('boats-source')) {
          const boatFeatures = [];

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

            // Silky smooth 60 FPS camera follow (damped centering)
            if (activePresetRef.current === 'follow') {
              const currentCenter = map.getCenter();
              const cameraLat = currentCenter.lat + (anim.lat - currentCenter.lat) * 0.08;
              const cameraLng = currentCenter.lng + (anim.lng - currentCenter.lng) * 0.08;
              map.jumpTo({ center: [cameraLng, cameraLat] });
            }

            // Real-time 60 FPS User Trail updates matching the smooth boat coordinates
            const userSource = map.getSource('trail-source-user');
            if (userSource && userTrailPointsRef.current) {
              const userPoints = userTrailPointsRef.current.filter(p => p && p.lat && p.lng);
              const coords = userPoints.map(p => [p.lng, p.lat]);
              
              // Append the latest interpolated position to the end of the trail
              coords.push([anim.lng, anim.lat]);
              
              const first = coords[0];
              const last = coords[coords.length - 1];
              const hasLength = first && last && (Math.abs(first[1] - last[1]) > 0.00005 || Math.abs(first[0] - last[0]) > 0.00005);
              
              userSource.setData({
                type: 'FeatureCollection',
                features: (coords.length >= 2 && hasLength) ? [{
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: coords
                  }
                }] : [{
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: [[0, 0], [0.001, 0.001]]
                  }
                }]
              });
            }

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

            const colorHex = (boat.color || '#f43f5e').replace('#', '');
            const iconName = `boat-fleet-${colorHex}`;

            // Real-time 60 FPS AI Trail updates matching the smooth boat coordinates
            const trailSource = map.getSource(`trail-source-${id}`);
            if (trailSource && fleetTrailPointsRef.current[id]) {
              const fleetPoints = fleetTrailPointsRef.current[id].filter(p => p && p.lat && p.lng);
              const coords = fleetPoints.map(p => [p.lng, p.lat]);
              
              // Append the latest interpolated position to the end of the trail
              coords.push([anim.lng, anim.lat]);
              
              const first = coords[0];
              const last = coords[coords.length - 1];
              const hasLength = first && last && (Math.abs(first[1] - last[1]) > 0.00005 || Math.abs(first[0] - last[0]) > 0.00005);
              
              trailSource.setData({
                type: 'FeatureCollection',
                features: (coords.length >= 2 && hasLength) ? [{
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: coords
                  }
                }] : [{
                  type: 'Feature',
                  geometry: {
                    type: 'LineString',
                    coordinates: [[0, 0], [0.001, 0.001]]
                  }
                }]
              });
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
      zoom: zoom - 1,
      pitch: 55, // Slightly reduced pitch to request fewer tiles near the horizon
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

      // Thicker gate/lines to match the 2D version visual hierarchy
      map.addLayer({
        id: 'checkpoint-gates-layer',
        type: 'line',
        source: 'checkpoint-gates',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 12,
          'line-opacity': 0.85
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

    const clearPreset = () => setActivePreset('manual');
    map.on('dragstart', clearPreset);
    map.on('zoomstart', clearPreset);
    map.on('pitchstart', clearPreset);
    map.on('rotatestart', clearPreset);

    return () => {
      Object.values(markersRef.current).forEach(m => m.remove());
      markersRef.current = {};
      map.off('dragstart', clearPreset);
      map.off('zoomstart', clearPreset);
      map.off('pitchstart', clearPreset);
      map.off('rotatestart', clearPreset);
      map.remove();
    };
  }, []);

  // Effect 1: Auto zoom-in based on distance to buoy target
  useEffect(() => {
    if (activePreset !== 'follow') return;
    const map = mapRef.current;
    if (!map || !boatPos || !boatPos.lat || !boatPos.lng) return;

    let targetZoom = zoom - 1; // Default zoom (approx 14.5)
    if (targetPos && targetPos[0] && targetPos[1] && targetName !== 'FINISHED') {
      const boatPt = turf.point([boatPos.lng, boatPos.lat]);
      const targetPt = turf.point([targetPos[1], targetPos[0]]);
      const distKm = turf.distance(boatPt, targetPt, { units: 'kilometers' });
      if (distKm < 0.4) {
        const factor = Math.max(0, Math.min(1, (0.4 - distKm) / 0.4));
        targetZoom = (zoom - 1) + factor * 2.2; // Zoom in up to 2.2 levels closer
      }
    }

    const currentZoom = map.getZoom();
    const zoomDiff = Math.abs(currentZoom - targetZoom);

    if (zoomDiff > 0.15) {
      map.easeTo({
        zoom: targetZoom,
        duration: 1000,
        essential: true
      });
    }
  }, [boatPos?.lat, boatPos?.lng, activePreset, targetPos, targetName, zoom]);

  // Effect 2: Update Static Course GeoJSON sources (Depends only on checkpoints layout)
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

      const gateFeatures = checkpoints
        .filter(cp => cp.kind !== 'buoy' && cp.coords)
        .map(cp => {
          const color = cp.kind === 'start' ? '#22c55e'
            : cp.kind === 'finish' ? '#ef4444' : '#f5cb5c';

          return {
            type: 'Feature',
            properties: { color },
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

    if (map.loaded()) {
      updateStaticLayers();
    } else {
      map.on('load', updateStaticLayers);
    }
  }, [checkpoints]);
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

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            lineMetrics: true, // required for line-gradient
            data: {
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [[0, 0], [0.001, 0.001]]
                }
              }]
            }
          });

          const rawColor = id === 'user' ? '#FF5D00' : (fleet.find(b => b.id === id)?.color || '#f43f5e');

          // 1. Wake layer (fuzzy white-blue foam wake)
          map.addLayer({
            id: wakeLayerId,
            type: 'line',
            source: sourceId,
            paint: {
              'line-width': 18,
              'line-opacity': 0.35,
              'line-blur': 5,
              'line-gradient': [
                'interpolate',
                ['linear'],
                ['line-progress'],
                0, 'rgba(224, 242, 254, 0)',
                0.5, 'rgba(224, 242, 254, 0.1)',
                0.8, 'rgba(255, 255, 255, 0.25)',
                1, 'rgba(255, 255, 255, 0.6)'
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
              'line-width': 3.5,
              'line-opacity': 0.85,
              'line-gradient': [
                'interpolate',
                ['linear'],
                ['line-progress'],
                0, 'rgba(255, 255, 255, 0)',
                0.5, hexToRgba(rawColor, 0.25),
                0.9, rawColor,
                1, rawColor
              ]
            },
            layout: {
              'line-cap': 'round',
              'line-join': 'round'
            }
          }, beforeLayerId);
        }
      });
    };

    if (map.loaded()) {
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
      // 1. Save User Trail points to ref
      userTrailPointsRef.current = [...trace];

      // 2. Save AI Trails points to ref
      if (aiTrails) {
        Object.entries(aiTrails).forEach(([boatId, points]) => {
          fleetTrailPointsRef.current[boatId] = points;
        });
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
      if (map.loaded()) {
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
  }, [trace, aiTrails, boatPos, fleet, targetPos, targetName]);

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
      }
      newMarkers[flatKey] = flatMarker;
      delete markersRef.current[flatKey];
    });

    // 2. Render Line Endpoints and Midpoint Crossing Arrows
    checkpoints.forEach(cp => {
      if (cp.kind === 'buoy' || !cp.coords) return;
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
          el.innerHTML = `
            <div style="
              width: 18px; 
              height: 18px; 
              border-radius: 50%; 
              background: radial-gradient(circle at 6px 6px, ${color}, #1e293b); 
              box-shadow: 0 3px 6px rgba(0,0,0,0.5);
              border: 2px solid white;
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



  // Preset 1 effect: All Boats in viewport (Focus coming toward camera)
  useEffect(() => {
    if (activePreset !== 'all-boats') return;
    const map = mapRef.current;
    if (!map || !boatPos || !boatPos.lat || !boatPos.lng) return;

    const coords = [[boatPos.lng, boatPos.lat]];
    fleet.forEach(b => {
      const lat = b.lat || b.pos?.lat;
      const lng = b.lng || b.pos?.lng;
      if (lat && lng) coords.push([lng, lat]);
    });

    const centerVal = getCenterOfCoords(coords);
    const maxDist = getMaxDistanceBetween(centerVal, coords);
    const zoomVal = Math.max(13, Math.min(17.5, 16.2 - Math.log2(maxDist * 1000 + 1) * 0.8));
    const heading = boatPos.heading || 0;
    const camBearing = (heading + 180) % 360;

    map.easeTo({
      center: centerVal,
      zoom: zoomVal,
      bearing: camBearing,
      pitch: 50,
      duration: 600
    });
  }, [activePreset, boatPos, fleet]);

  // Preset 2 effect: Focus boat from target location (coming towards)
  useEffect(() => {
    if (activePreset !== 'target') return;
    const map = mapRef.current;
    if (!map || !boatPos || !boatPos.lat || !boatPos.lng || !targetPos || !targetPos[0]) return;

    const targetLng = targetPos[1];
    const targetLat = targetPos[0];
    const targetPt = turf.point([targetLng, targetLat]);
    const boatPt = turf.point([boatPos.lng, boatPos.lat]);

    const dist = turf.distance(targetPt, boatPt, { units: 'kilometers' });
    const bearingVal = turf.bearing(targetPt, boatPt);
    const zoomVal = Math.max(13.5, Math.min(18.0, 16.8 - Math.log2(dist * 1000 + 1) * 0.9));

    map.easeTo({
      center: [targetLng, targetLat],
      zoom: zoomVal,
      bearing: bearingVal,
      pitch: 60,
      duration: 600
    });
  }, [activePreset, boatPos, targetPos]);

  // Preset 3 effect: Focus boat from last target position (moving from)
  useEffect(() => {
    if (activePreset !== 'last-target') return;
    const map = mapRef.current;
    if (!map || !boatPos || !boatPos.lat || !boatPos.lng) return;

    const targetIdx = checkpoints.findIndex(cp => cp.id.toUpperCase() === targetName.toUpperCase());
    let lastCp = null;
    if (targetIdx > 0) {
      lastCp = checkpoints[targetIdx - 1];
    } else {
      lastCp = checkpoints.find(cp => cp.kind === 'start');
    }

    let lastLat = null, lastLng = null;
    if (lastCp) {
      if (lastCp.coord) {
        lastLat = lastCp.coord[0];
        lastLng = lastCp.coord[1];
      } else if (lastCp.coords && lastCp.coords.length > 0) {
        lastLat = (lastCp.coords[0][0] + lastCp.coords[1][0]) / 2;
        lastLng = (lastCp.coords[0][1] + lastCp.coords[1][1]) / 2;
      }
    }

    if (lastLat === null || lastLng === null) return;

    const lastPt = turf.point([lastLng, lastLat]);
    const boatPt = turf.point([boatPos.lng, boatPos.lat]);
    const dist = turf.distance(lastPt, boatPt, { units: 'kilometers' });
    const bearingVal = turf.bearing(lastPt, boatPt);
    const zoomVal = Math.max(13.0, Math.min(18.0, 16.8 - Math.log2(dist * 1000 + 1) * 0.9));

    map.easeTo({
      center: [lastLng, lastLat],
      zoom: zoomVal,
      bearing: bearingVal,
      pitch: 65,
      duration: 600
    });
  }, [activePreset, boatPos, checkpoints, targetName]);

  // Preset 4 effect: Auto Rotate with all boats in view
  useEffect(() => {
    if (activePreset !== 'auto-rotate') return;
    const map = mapRef.current;
    if (!map) return;

    let rafId;
    const rotate = () => {
      autoRotateAngleRef.current = (autoRotateAngleRef.current + 0.15) % 360;

      const coords = [];
      if (boatPos && boatPos.lat && boatPos.lng) {
        coords.push([boatPos.lng, boatPos.lat]);
      }
      fleet.forEach(b => {
        const lat = b.lat || b.pos?.lat;
        const lng = b.lng || b.pos?.lng;
        if (lat && lng) coords.push([lng, lat]);
      });

      if (coords.length > 0) {
        const centerVal = getCenterOfCoords(coords);
        const maxDist = getMaxDistanceBetween(centerVal, coords);
        const zoomVal = Math.max(13, Math.min(17.5, 16.2 - Math.log2(maxDist * 1000 + 1) * 0.8));

        map.jumpTo({
          center: centerVal,
          zoom: zoomVal,
          bearing: autoRotateAngleRef.current,
          pitch: 45
        });
      }

      rafId = requestAnimationFrame(rotate);
    };

    rafId = requestAnimationFrame(rotate);
    return () => cancelAnimationFrame(rafId);
  }, [activePreset, boatPos, fleet]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div 
        ref={mapContainerRef} 
        className="td-map-container"
        style={{ width: '100%', height: '100%' }} 
      />
      
      {/* Camera Presets Overlay */}
      <div style={{
        position: 'absolute',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '24px',
        padding: '6px 12px',
        display: 'flex',
        gap: '8px',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)'
      }}>
        {[
          { id: 'follow', label: 'Follow Boat', desc: 'Lock camera to focus boat' },
          { id: 'all-boats', label: 'All Boats', desc: 'Focus coming toward camera' },
          { id: 'target', label: 'Target View', desc: 'Looking from target buoy', disabled: !targetPos || !targetPos[0] },
          { id: 'last-target', label: 'Last Target', desc: 'Looking from last buoy' },
          { id: 'auto-rotate', label: 'Auto Rotate', desc: 'Orbiting fleet view' }
        ].map(preset => {
          const isActive = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              disabled={preset.disabled}
              title={preset.desc}
              onClick={() => setActivePreset(isActive ? null : preset.id)}
              style={{
                background: isActive ? '#06b6d4' : 'transparent',
                color: preset.disabled ? '#475569' : (isActive ? '#ffffff' : '#e2e8f0'),
                border: 'none',
                borderRadius: '16px',
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                cursor: preset.disabled ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap'
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
