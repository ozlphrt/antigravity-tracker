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
  const markersRef = useRef({}); // Store active HTML markers (buoys, flat rings, endpoints, midpoints, boats)

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const mapCenter = [center[1], center[0]];

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: maplibreStyle,
      center: mapCenter,
      zoom: zoom - 1,
      pitch: 60,
      bearing: -15,
      antialias: true
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

      map.addLayer({
        id: 'course-connection-layer',
        type: 'line',
        source: 'course-lines',
        paint: {
          'line-color': '#06b6d4',
          'line-width': 4,
          'line-dasharray': [3, 2],
          'line-opacity': 0.85
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

      map.addLayer({
        id: 'checkpoint-gates-layer',
        type: 'line',
        source: 'checkpoint-gates',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 8,
          'line-opacity': 0.9
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
          'line-opacity': 0.75
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
          'line-opacity': 0.8
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
          'line-width': 3,
          'line-dasharray': [0, 3],
          'line-opacity': 0.7
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

  // Update Dynamic Sources and Layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateMapData = () => {
      if (!map.getSource('course-lines') || 
          !map.getSource('checkpoint-gates') || 
          !map.getSource('boat-trails') ||
          !map.getSource('telemetry-heading') ||
          !map.getSource('telemetry-bearing')) return;

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
      updateMapData();
    } else {
      map.on('load', updateMapData);
    }
  }, [checkpoints, trace, aiTrails, boatPos, fleet, targetPos, targetName]);

  // Update HTML Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const newMarkers = {};

    // 1. Render Buoys (Flat Spinning Turn Ring + Billboard ID Badge)
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

      // A. Flat Perspective Buoy Marker (combined spinning ring and ID badge)
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

      // B. Flat pulsing arrow at midpoint oriented in crossing bearing
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
        el.style.width = '48px';
        el.style.height = '48px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.innerHTML = `
          <style>
            @keyframes arrow-pulse-${cp.id} {
              0% { transform: scale(0.9); opacity: 0.65; }
              50% { transform: scale(1.2); opacity: 1; }
              100% { transform: scale(0.9); opacity: 0.65; }
            }
          </style>
          <div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; animation: arrow-pulse-${cp.id} 2s ease-in-out infinite; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.45));">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="#fff" stroke-width="1.8" width="36" height="36">
              <path d="M12 4 L4 13 L9 13 L9 20 L15 20 L15 13 L20 13 Z" />
            </svg>
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

    // 3. Render Main Simulated Boat (flat map-aligned)
    if (boatPos && boatPos.lat && boatPos.lng) {
      const key = 'main-boat';
      let marker = markersRef.current[key];
      const heading = boatPos.heading || 0;

      if (!marker) {
        const el = document.createElement('div');
        el.style.width = '30px';
        el.style.height = '30px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.innerHTML = `
          <div style="width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.45));">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#33658A" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" width="30" height="30">
              <path d="M12 2 L19 21 Q12 18 5 21 Z" />
            </svg>
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

      newMarkers[key] = marker;
      delete markersRef.current[key];
    }

    // 4. Render Fleet simulated boats
    fleet.forEach(boat => {
      const lat = boat.lat || boat.pos?.lat;
      const lng = boat.lng || boat.pos?.lng;
      if (!lat || !lng) return;
      const key = `fleet-boat-${boat.id}`;
      let marker = markersRef.current[key];
      const heading = boat.heading || 0;

      if (!marker) {
        const el = document.createElement('div');
        el.style.width = '24px';
        el.style.height = '24px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.innerHTML = `
          <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 3px 5px rgba(0,0,0,0.35));">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${boat.color || '#f43f5e'}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" width="24" height="24">
              <path d="M12 2 L19 21 Q12 18 5 21 Z" />
            </svg>
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

      newMarkers[key] = marker;
      delete markersRef.current[key];
    });

    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = newMarkers;
  }, [checkpoints, boatPos, fleet, targetName]);

  return (
    <div 
      ref={mapContainerRef} 
      className="td-map-container"
      style={{ width: '100%', height: '100%', position: 'relative' }} 
    />
  );
}
