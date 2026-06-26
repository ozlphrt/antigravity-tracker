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
  const markersRef = useRef({}); // Store active HTML markers (buoys, boats, line endpoints)

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Convert leaflet center [lat, lng] to maplibre [lng, lat]
    const mapCenter = [center[1], center[0]];

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: maplibreStyle,
      center: mapCenter,
      zoom: zoom - 1, // MapLibre zoom is slightly different
      pitch: 60, // Tilts the camera for 3D effect
      bearing: -15,
      antialias: true
    });

    mapRef.current = map;

    // Load Terrain and 3D sky/fog effects on load
    map.on('load', () => {
      // Add AWS Terrain-RGB DEM tiles source
      map.addSource('terrain-source', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15
      });

      // Enable 3D Terrain
      map.setTerrain({
        source: 'terrain-source',
        exaggeration: 1.8 // Exaggerate elevation slightly for better visual validation
      });

      // Add a nice sky layer
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-color': 'rgba(11, 15, 25, 0.9)',
          'sky-atmosphere-halo-color': 'rgba(6, 182, 212, 0.45)',
          'sky-atmosphere-sun-intensity': 12
        }
      });

      // Add Course GeoJSON sources and layers
      map.addSource('course-lines', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Render course connection dashed line
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

      // Add Checkpoint Gates (Start, Gate, Finish Lines) GeoJSON source
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

      // Add Boat Trails source and layer
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

      // Add Telemetry Sources and Layers
      map.addSource('telemetry-heading', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addSource('telemetry-bearing', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Render Forward Heading Projection
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

      // Render Dynamic Target Bearing Line
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

    // Add controls
    map.addControl(new maplibregl.NavigationControl({
      showCompass: true,
      visualizePitch: true
    }));

    return () => {
      // Clean up markers
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

      // 1. Connection line sequence
      const connectionCoordinates = checkpoints
        .map(cp => {
          if (cp.kind === 'buoy' && cp.coord) {
            return [cp.coord[1], cp.coord[0]];
          } else if (cp.coords) {
            // Midpoint of line
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

      // 2. Extruded lines (Start, Gate, Finish Lines)
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

      // 3. User & Fleet Trails
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

      // 4. Telemetry (Heading Projection & Bearing Line)
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

  // Update HTML Markers (Buoys, Endpoints and Boats)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const newMarkers = {};

    // 1. Render Buoys
    checkpoints.forEach(cp => {
      if (cp.kind !== 'buoy' || !cp.coord) return;
      const key = `buoy-${cp.id}`;

      let marker = markersRef.current[key];
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'buoy-marker-3d';
        el.style.width = '32px';
        el.style.height = '32px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        
        el.innerHTML = `
          <div style="
            width: 24px; 
            height: 24px; 
            border-radius: 50%; 
            background: radial-gradient(circle at 8px 8px, #ff7b54, #d32f2f); 
            box-shadow: 0 4px 8px rgba(0,0,0,0.5), inset 0 -4px 6px rgba(0,0,0,0.3);
            border: 2px solid white;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 10px;
            font-weight: 900;
          ">${cp.id.replace(/\D/g, '')}</div>
        `;

        marker = new maplibregl.Marker({ element: el })
          .setLngLat([cp.coord[1], cp.coord[0]])
          .addTo(map);
      } else {
        marker.setLngLat([cp.coord[1], cp.coord[0]]);
      }

      newMarkers[key] = marker;
      delete markersRef.current[key];
    });

    // 2. Render Line Endpoints (Start, Gate, Finish Buoys)
    checkpoints.forEach(cp => {
      if (cp.kind === 'buoy' || !cp.coords) return;
      const color = cp.kind === 'start' ? '#22c55e'
        : cp.kind === 'finish' ? '#ef4444' : '#f5cb5c';

      cp.coords.forEach((coord, idx) => {
        const key = `line-endpoint-${cp.id}-${idx}`;
        let marker = markersRef.current[key];
        if (!marker) {
          const el = document.createElement('div');
          el.style.width = '20px';
          el.style.height = '20px';
          el.innerHTML = `
            <div style="
              width: 16px; 
              height: 16px; 
              border-radius: 50%; 
              background: radial-gradient(circle at 6px 6px, ${color}, #1e293b); 
              box-shadow: 0 3px 6px rgba(0,0,0,0.5);
              border: 1.5px solid white;
            "></div>
          `;
          marker = new maplibregl.Marker({ element: el })
            .setLngLat([coord[1], coord[0]])
            .addTo(map);
        } else {
          marker.setLngLat([coord[1], coord[0]]);
        }
        newMarkers[key] = marker;
        delete markersRef.current[key];
      });
    });

    // 3. Render Main Simulated Boat (stuck to terrain and rotated natively)
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

    // Remove remaining old markers
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = newMarkers;
  }, [checkpoints, boatPos, fleet]);

  return (
    <div 
      ref={mapContainerRef} 
      className="td-map-container"
      style={{ width: '100%', height: '100%', position: 'relative' }} 
    />
  );
}
