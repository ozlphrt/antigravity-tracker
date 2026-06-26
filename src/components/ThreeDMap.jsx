import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import 'maplibre-gl/dist/maplibre-gl.css';

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

    map.on('load', () => {
      map.addSource('terrain-source', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15
      });

      map.setTerrain({
        source: 'terrain-source',
        exaggeration: 1.8
      });

      map.addSource('course-lines', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
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
          'line-opacity': 0.55
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

      map.addSource('boat-trails', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'boat-trails-layer',
        type: 'line',
        source: 'boat-trails',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.7
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
          'line-color': '#33658a',
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

    return () => {
      Object.values(markersRef.current).forEach(m => m.remove());
      markersRef.current = {};
      map.remove();
    };
  }, []);

  // Effect 1: Camera follow boat (Only runs when user boat coordinates change)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boatPos || !boatPos.lat || !boatPos.lng) return;

    map.easeTo({
      center: [boatPos.lng, boatPos.lat],
      duration: 1200,
      essential: true
    });
  }, [boatPos?.lat, boatPos?.lng]);

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

  // Effect 3: Update Telemetry & Trail GeoJSON sources (Depends on active navigation/history)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateTelemetryLayers = () => {
      if (!map.getSource('boat-trails') ||
          !map.getSource('telemetry-heading') ||
          !map.getSource('telemetry-bearing')) return;

      const trailFeatures = [];

      if (trace && trace.length > 1) {
        trailFeatures.push({
          type: 'Feature',
          properties: { color: '#33658a' },
          geometry: {
            type: 'LineString',
            coordinates: trace.map(p => [p.lng, p.lat])
          }
        });
      }

      if (aiTrails) {
        Object.entries(aiTrails).forEach(([boatId, points]) => {
          if (points && points.length > 1) {
            const boatColor = fleet.find(b => b.id === boatId)?.color || '#f43f5e';
            trailFeatures.push({
              type: 'Feature',
              properties: { color: boatColor },
              geometry: {
                type: 'LineString',
                coordinates: points.map(p => [p.lng, p.lat])
              }
            });
          }
        });
      }

      map.getSource('boat-trails').setData({
        type: 'FeatureCollection',
        features: trailFeatures
      });

      if (boatPos && boatPos.lat && boatPos.lng) {
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
        map.getSource('telemetry-heading').setData({ type: 'FeatureCollection', features: [] });
        map.getSource('telemetry-bearing').setData({ type: 'FeatureCollection', features: [] });
      }
    };

    if (map.loaded()) {
      updateTelemetryLayers();
    } else {
      map.on('load', updateTelemetryLayers);
    }
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

  // Effect 5: Update Boat HTML Markers (Only runs when telemetry or fleet simulation coordinates change)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const newBoatMarkers = {};

    // 1. Render Main Simulated/GPS Boat as CSS 3D Sailboat
    if (boatPos && boatPos.lat && boatPos.lng) {
      const key = 'main-boat';
      let marker = markersRef.current[key];
      const heading = boatPos.heading || 0;

      if (!marker) {
        const el = document.createElement('div');
        el.style.width = '40px';
        el.style.height = '40px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.innerHTML = `
          <div style="position: relative; width: 40px; height: 40px; transform-style: preserve-3d; pointer-events: none;">
            <!-- Hull flat on water -->
            <div style="
              position: absolute; 
              left: 12px; 
              top: 4px; 
              width: 16px; 
              height: 32px; 
              background: #33658A; 
              clip-path: polygon(50% 0%, 100% 75%, 50% 100%, 0% 75%); 
              border: 1.8px solid #ffffff;
              box-shadow: inset 0 2px 4px rgba(255,255,255,0.2);
            "></div>
            <!-- Mast standing vertical -->
            <div style="
              position: absolute;
              left: 20px;
              top: 20px;
              width: 0px;
              height: 0px;
              transform: rotateX(-90deg) rotateY(15deg);
              transform-style: preserve-3d;
              transform-origin: bottom center;
            ">
              <div style="position: absolute; left: -1px; bottom: 0; width: 2px; height: 26px; background: #4b5563;"></div>
              <div style="
                position: absolute; 
                left: 1px; 
                bottom: 4px; 
                width: 0; 
                height: 0; 
                border-left: 11px solid #f8fafc; 
                border-bottom: 7px solid transparent; 
                border-top: 10px solid transparent;
              "></div>
            </div>
          </div>
        `;

        marker = new maplibregl.Marker({
          element: el,
          rotationAlignment: 'map',
          pitchAlignment: 'map'
        })
          .setLngLat([boatPos.lng, boatPos.lat])
          .setRotation(heading)
          .addTo(map);
      } else {
        marker.setLngLat([boatPos.lng, boatPos.lat]);
        marker.setRotation(heading);
      }

      newBoatMarkers[key] = marker;
      delete markersRef.current[key];
    }

    // 2. Render Fleet simulated boats as CSS 3D Sailboats
    fleet.forEach(boat => {
      const lat = boat.lat || boat.pos?.lat;
      const lng = boat.lng || boat.pos?.lng;
      if (!lat || !lng) return;
      const key = `fleet-boat-${boat.id}`;
      let marker = markersRef.current[key];
      const heading = boat.heading || 0;

      if (!marker) {
        const el = document.createElement('div');
        el.style.width = '40px';
        el.style.height = '40px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.innerHTML = `
          <div style="position: relative; width: 40px; height: 40px; transform-style: preserve-3d; pointer-events: none;">
            <!-- Hull flat on water -->
            <div style="
              position: absolute; 
              left: 12px; 
              top: 4px; 
              width: 16px; 
              height: 32px; 
              background: ${boat.color || '#f43f5e'}; 
              clip-path: polygon(50% 0%, 100% 75%, 50% 100%, 0% 75%); 
              border: 1.8px solid #ffffff;
            "></div>
            <!-- Mast standing vertical -->
            <div style="
              position: absolute;
              left: 20px;
              top: 20px;
              width: 0px;
              height: 0px;
              transform: rotateX(-90deg) rotateY(12deg);
              transform-style: preserve-3d;
              transform-origin: bottom center;
            ">
              <div style="position: absolute; left: -1px; bottom: 0; width: 2px; height: 26px; background: #4b5563;"></div>
              <div style="
                position: absolute; 
                left: 1px; 
                bottom: 4px; 
                width: 0; 
                height: 0; 
                border-left: 11px solid #f8fafc; 
                border-bottom: 7px solid transparent; 
                border-top: 10px solid transparent;
              "></div>
            </div>
          </div>
        `;

        marker = new maplibregl.Marker({
          element: el,
          rotationAlignment: 'map',
          pitchAlignment: 'map'
        })
          .setLngLat([lng, lat])
          .setRotation(heading)
          .addTo(map);
      } else {
        marker.setLngLat([lng, lat]);
        marker.setRotation(heading);
      }

      newBoatMarkers[key] = marker;
      delete markersRef.current[key];
    });

    // Remove remaining old boat markers
    Object.keys(markersRef.current).forEach(key => {
      if (key.startsWith('main-boat') || key.startsWith('fleet-boat-')) {
        markersRef.current[key].remove();
        delete markersRef.current[key];
      }
    });

    // Merge new boat markers into store
    Object.assign(markersRef.current, newBoatMarkers);
  }, [boatPos, fleet]);

  return (
    <div 
      ref={mapContainerRef} 
      className="td-map-container"
      style={{ width: '100%', height: '100%', position: 'relative' }} 
    />
  );
}
