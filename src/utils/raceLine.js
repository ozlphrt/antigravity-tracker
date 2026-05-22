import L from 'leaflet';
import * as turf from '@turf/turf';

export const RACE_LINE_MAX_HEIGHT = 28;
export const RACE_LINE_MIN_HEIGHT = 10;
export const RACE_LINE_MIN_WIDTH = 24;

/** @param {'up' | 'down' | 'port' | 'starboard' | undefined} crossing — legacy port/starboard mapped to down/up */
export const normalizeLineCrossing = (crossing) => {
  if (crossing === 'down') return 'down';
  if (crossing === 'up') return 'up';
  if (crossing === 'port') return 'down';
  if (crossing === 'starboard') return 'up';
  return 'up';
};

export const lineCrossingLabel = (crossing) => (
  normalizeLineCrossing(crossing) === 'up' ? 'Up' : 'Down'
);

export const getLineBearing = (coords) => {
  const [start, end] = coords;
  const startLat = start[0] * (Math.PI / 180);
  const endLat = end[0] * (Math.PI / 180);
  const deltaLng = (end[1] - start[1]) * (Math.PI / 180);
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

export const getLineMidpoint = (coords) => [
  (coords[0][0] + coords[1][0]) / 2,
  (coords[0][1] + coords[1][1]) / 2,
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const getLinePixelWidth = (map, coords) => {
  const a = map.latLngToContainerPoint([coords[0][0], coords[0][1]]);
  const b = map.latLngToContainerPoint([coords[1][0], coords[1][1]]);
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  return distance < 2 ? RACE_LINE_MIN_WIDTH : distance;
};

/** Thickness scales with zoom and stays proportional to on-screen line length. */
export const getRaceLineDimensions = (map, pixelWidth) => {
  const zoom = map.getZoom();
  const zoomScaled = clamp(4 + zoom * 1.35, RACE_LINE_MIN_HEIGHT, RACE_LINE_MAX_HEIGHT);
  const widthScaled = clamp(pixelWidth * 0.14, RACE_LINE_MIN_HEIGHT, RACE_LINE_MAX_HEIGHT);
  const height = Math.round(Math.min(zoomScaled, widthScaled));

  return {
    height,
    border: clamp(Math.round(height * 0.11), 2, 3),
    dotSize: clamp(Math.round(height * 0.36), 6, 10),
    dotInset: clamp(Math.round(height * 0.28), 4, 8),
    arrowSize: clamp(Math.round(height * 1.5), 32, 56), // significantly larger arrows
  };
};

const raceLineArrowSvg = (size) => (
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h12"/><path d="M13 7l5 5-5 5"/></svg>`
);

/** Arrows point across the line (A→B defines the span; boats pass through on the arrow bearing). */
const buildRaceLineArrows = (widthPx, arrowSize) => {
  const count = widthPx >= 140 ? 3 : widthPx >= 80 ? 2 : 1;
  return Array.from({ length: count }, (_, index) => {
    const left = `${((index + 1) / (count + 1)) * 100}%`;
    const delay = (index * 0.22).toFixed(2);
    return `<span class="race-line__arrow race-line__arrow--cross" style="left:${left};width:${arrowSize}px;height:${arrowSize}px;">
      <span class="race-line__arrow-motion" style="animation-delay:${delay}s">${raceLineArrowSvg(arrowSize)}</span>
    </span>`;
  }).join('');
};

/** Screen-space angle for CSS rotate (0° = east); matches Leaflet container axes. */
export const getLineCssRotation = (map, coords) => {
  const a = map.latLngToContainerPoint([coords[0][0], coords[0][1]]);
  const b = map.latLngToContainerPoint([coords[1][0], coords[1][1]]);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
};

/** coords: [[lat, lng], [lat, lng]] */
export const getLineLengthMeters = (coords) => {
  const km = turf.distance(
    turf.point([coords[0][1], coords[0][0]]),
    turf.point([coords[1][1], coords[1][0]]),
    { units: 'kilometers' },
  );
  return km * 1000;
};

export const formatLineLength = (meters) => {
  const m = Math.round(meters);
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m} m`;
};

export const createLineLengthIcon = (label) => new L.DivIcon({
  html: `<div class="race-line-length-label">${label}</div>`,
  className: 'race-line-length-label-shell',
  iconSize: [72, 28],
  iconAnchor: [36, 14],
});

/** @param {'start' | 'gate' | 'finish'} kind */
export const createRaceLineIcon = (
  kind,
  rotationDeg,
  widthPx,
  dimensions,
  crossing = 'up',
  preview = false,
  showArrows = true,
) => {
  const width = Math.max(Math.round(widthPx), 2);
  const { height, border, dotSize, dotInset, arrowSize } = dimensions;
  const crossSide = normalizeLineCrossing(crossing);
  const previewClass = preview ? ' race-line--preview' : '';
  const style = [
    `transform:rotate(${rotationDeg}deg)`,
    `width:${width}px`,
    `height:${height}px`,
    `--line-border:${border}px`,
    `--dot-size:${dotSize}px`,
    `--dot-inset:${dotInset}px`,
  ].join(';');
  const arrows = showArrows ? buildRaceLineArrows(width, arrowSize) : '';
  const arrowPad = showArrows ? Math.ceil(arrowSize * 0.65) : 0;

  return new L.DivIcon({
    html: `<div class="race-line race-line--${kind} race-line--cross-${crossSide}${previewClass}" style="${style}">
      <span class="race-line__bar"></span>
      ${arrows}
      <span class="race-line__dot race-line__dot--start"></span>
      <span class="race-line__dot race-line__dot--end"></span>
    </div>`,
    className: 'race-line-icon-shell',
    iconSize: [width, height + arrowPad * 2],
    iconAnchor: [width / 2, height / 2],
  });
};
