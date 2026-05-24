import React, { useState, useEffect, useRef } from 'react';
import { useMapEvents, CircleMarker, Popup, Marker } from 'react-leaflet';
import L from 'leaflet';

const CACHE_TIMEOUT = 5000; // debounce timeout to avoid spamming overpass

// Generate HTML for the standard nautical charting icons using official JOSM SVGs
const createSeamarkIcon = (tags, currentZoom) => {
  const type = tags.find(t => t.key === 'type')?.val || '';
  const category = tags.find(t => t.key.includes('category'))?.val || '';
  const colorStr = tags.find(t => t.key.includes('colour'))?.val || 'generic';
  const shape = tags.find(t => t.key.includes('shape'))?.val || '';
  const colors = colorStr.split(';'); 
  const primaryColorName = colors[0];
  const baseUrl = import.meta.env.BASE_URL;
                       
  let basePath = '';
  let topMarkPath = '';
  
  // Calculate dynamic size based on zoom level
  // Base size is very small (12) at zoom 14, scales by 1.25x per zoom level
  const scale = Math.pow(1.25, currentZoom - 14);
  let baseWidth = 12;
  let baseHeight = 12;
  let isLight = false;

  if (type === 'buoy_lateral' || type === 'beacon_lateral') {
    const buoyShape = (shape === 'conical' || shape === 'cone') ? 'conical' : 'can';
    basePath = `${baseUrl}josm-seamarks/icons/svg/Q/${buoyShape}/${primaryColorName}.svg`;
  } else if (type === 'buoy_cardinal' || type === 'beacon_cardinal') {
    basePath = `${baseUrl}josm-seamarks/icons/svg/Q/pillar/${primaryColorName}.svg`;
    if (category === 'north') topMarkPath = '2_cones_up';
    else if (category === 'south') topMarkPath = '2_cones_down';
    else if (category === 'east') topMarkPath = '2_cones_base_together';
    else if (category === 'west') topMarkPath = '2_cones_point_together';
  } else if (type === 'buoy_safe_water') {
    basePath = `${baseUrl}josm-seamarks/icons/svg/Q/spherical/red.svg`; 
  } else if (type === 'buoy_special_purpose' || type === 'beacon_special_purpose') {
    basePath = `${baseUrl}josm-seamarks/icons/svg/Q/can/yellow.svg`;
  } else if (type === 'buoy_isolated_danger') {
    basePath = `${baseUrl}josm-seamarks/icons/svg/Q/pillar/black.svg`;
  } else if (type.includes('light')) {
    basePath = `${baseUrl}josm-seamarks/icons/svg/P/P1.major.svg`;
    baseWidth = 18;
    baseHeight = 18;
    isLight = true;
  } else if (type === 'landmark') {
    basePath = `${baseUrl}josm-seamarks/icons/svg/E/E22.svg`; 
  } else {
    // fallback generic pillar
    basePath = `${baseUrl}josm-seamarks/icons/svg/Q/pillar/generic.svg`;
  }
  
  const width = Math.max(8, Math.round(baseWidth * scale));
  const height = Math.max(8, Math.round(baseHeight * scale));
  const anchor = isLight ? [width/2, height/2] : [width/2, height]; // Center for light flare, bottom center for buoys
  const topMarkOffset = Math.round(4 * scale);
  
  let html = `<div style="position: relative; width: ${width}px; height: ${height}px; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5));">`;
  html += `<img src="${basePath}" style="width: 100%; height: 100%; position: absolute; top: 0; left: 0;" onerror="this.src='${baseUrl}josm-seamarks/icons/svg/Q/pillar/generic.svg'" />`;
  
  if (topMarkPath) {
    html += `<img src="${baseUrl}josm-seamarks/icons/svg/Q/Q9/${topMarkPath}/black.svg" style="width: 100%; height: 100%; position: absolute; top: -${topMarkOffset}px; left: 0; z-index: 2; pointer-events: none;" onerror="this.style.display='none'" />`;
  }
  
  html += `</div>`;
  
  return new L.DivIcon({
    html: html,
    className: '',
    iconSize: [width, height],
    iconAnchor: anchor
  });
};

// Removed global seamarkIcon
export default function InteractiveSeamarksLayer() {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [zoomOk, setZoomOk] = useState(true);
  const debounceRef = useRef(null);
  const lastFetchedBoundsRef = useRef(null);
  
  const map = useMapEvents({
    moveend: () => {
      fetchSeamarks();
    },
    zoomend: () => {
      setCurrentZoom(map.getZoom());
      // When zooming out, it might exceed bounds, causing a refetch.
      fetchSeamarks();
    }
  });

  const [currentZoom, setCurrentZoom] = useState(map.getZoom());

  const fetchSeamarks = () => {
    const zoom = map.getZoom();
    
    // Only fetch if zoom is close enough to avoid massive queries
    if (zoom < 13) {
      setZoomOk(false);
      setNodes([]);
      return;
    }
    
    setZoomOk(true);
    
    const currentBounds = map.getBounds();
    const bodrumBounds = L.latLngBounds([36.95, 27.20], [37.15, 27.55]);

    if (lastFetchedBoundsRef.current && lastFetchedBoundsRef.current.contains(currentBounds)) {
      // Map is still completely inside our last padded fetch. No need to hit API again!
      return;
    }
    
    // If the view is fully inside Bodrum and we have it cached, use the cache
    if (bodrumBounds.contains(currentBounds)) {
      try {
        const cachedStr = localStorage.getItem('bodrum_seamarks');
        if (cachedStr) {
          setNodes(JSON.parse(cachedStr));
          lastFetchedBoundsRef.current = bodrumBounds;
          return;
        }
      } catch (e) {
        console.warn("Failed to parse bodrum cache", e);
      }
    }

    // Pad the bounds by 50% in all directions to fetch a larger area and avoid refetching on small pans
    const padLat = (currentBounds.getNorth() - currentBounds.getSouth()) * 0.5;
    const padLng = (currentBounds.getEast() - currentBounds.getWest()) * 0.5;
    
    const paddedBounds = L.latLngBounds(
      [currentBounds.getSouth() - padLat, currentBounds.getWest() - padLng],
      [currentBounds.getNorth() + padLat, currentBounds.getEast() + padLng]
    );
    
    const s = paddedBounds.getSouth();
    const w = paddedBounds.getWest();
    const n = paddedBounds.getNorth();
    const e = paddedBounds.getEast();
    
    const query = `
      [out:json][timeout:10];
      node["seamark:type"](${s},${w},${n},${e});
      out body;
    `;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    // Increased debounce to 1200ms to give Overpass API a break
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'data=' + encodeURIComponent(query)
        });
        
        if (!response.ok) throw new Error('Overpass API error ' + response.status);
        
        const data = await response.json();
        setNodes(data.elements || []);
        lastFetchedBoundsRef.current = paddedBounds;
      } catch (err) {
        console.error("Failed to fetch seamarks", err);
      } finally {
        setLoading(false);
      }
    }, 1200);
  };

  // Initial fetch and Bodrum cache logic
  useEffect(() => {
    const bodrumBounds = L.latLngBounds([36.95, 27.20], [37.15, 27.55]);
    const cachedStr = localStorage.getItem('bodrum_seamarks');
    
    if (cachedStr) {
      // We already cached Bodrum!
      try {
        const cachedNodes = JSON.parse(cachedStr);
        setNodes(cachedNodes);
        lastFetchedBoundsRef.current = bodrumBounds;
        if (!bodrumBounds.contains(map.getBounds())) {
           fetchSeamarks();
        }
      } catch (e) {
         fetchSeamarks();
      }
    } else {
      // First time launch: fetch Bodrum peninsula explicitly and cache it locally
      setLoading(true);
      const query = `
        [out:json][timeout:25];
        node["seamark:type"](36.95,27.20,37.15,27.55);
        out body;
      `;
      fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      })
      .then(res => res.ok ? res.json() : Promise.reject('Overpass error ' + res.status))
      .then(data => {
        const fetchedNodes = data.elements || [];
        setNodes(fetchedNodes);
        lastFetchedBoundsRef.current = bodrumBounds;
        try {
          localStorage.setItem('bodrum_seamarks', JSON.stringify(fetchedNodes));
          console.log("Successfully cached Bodrum seamarks locally!");
        } catch (e) {
          console.warn('Could not save bodrum seamarks to localStorage');
        }
        
        if (!bodrumBounds.contains(map.getBounds())) {
           fetchSeamarks();
        }
      })
      .catch(err => {
        console.error("Failed to fetch initial bodrum seamarks", err);
        fetchSeamarks();
      })
      .finally(() => setLoading(false));
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!zoomOk) return null;

  return (
    <>
      {nodes.map(node => {
        // Extract relevant seamark tags safely
        const tags = Object.entries(node.tags || {})
          .filter(([k]) => k.startsWith('seamark:'))
          .map(([k, v]) => ({ key: k.replace('seamark:', ''), val: v }));
          
        const typeTag = tags.find(t => t.key === 'type')?.val || 'unknown';
        const nameTag = tags.find(t => t.key === 'name')?.val || node.tags?.name || 'Unnamed Seamark';
        
        return (
          <Marker 
            key={node.id} 
            position={[node.lat, node.lon]}
            icon={createSeamarkIcon(tags, currentZoom)}
          >
            <Popup className="seamark-popup">
              <div style={{ minWidth: '150px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e293b' }}>{nameTag}</h4>
                <div style={{ fontSize: '12px', color: '#475569', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {tags.map(t => (
                    <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '2px' }}>
                      <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{t.key.replace(/-/g, ' ')}</span>
                      <span>{t.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}
