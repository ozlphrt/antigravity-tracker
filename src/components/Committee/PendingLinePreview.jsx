import { useMemo, useState } from 'react';
import { Marker, useMap, useMapEvents } from 'react-leaflet';
import RaceLineMarker from '../RaceLineMarker';
import {
  createLineLengthIcon,
  formatLineLength,
  getLineLengthMeters,
  getLineMidpoint,
} from '../../utils/raceLine';

const lineTools = new Set(['start', 'gate', 'finish']);

export default function PendingLinePreview({ anchor, kind, crossing = 'up' }) {
  const map = useMap();
  const [cursor, setCursor] = useState(() => {
    const center = map.getCenter();
    return [center.lat, center.lng];
  });

  useMapEvents({
    mousemove: (event) => {
      setCursor([event.latlng.lat, event.latlng.lng]);
    },
  });

  const coords = useMemo(() => [anchor, cursor], [anchor, cursor]);
  const lengthLabel = useMemo(
    () => formatLineLength(getLineLengthMeters(coords)),
    [coords],
  );
  const lengthIcon = useMemo(() => createLineLengthIcon(lengthLabel), [lengthLabel]);
  const midpoint = getLineMidpoint(coords);

  if (!lineTools.has(kind)) return null;

  return (
    <>
      <RaceLineMarker coords={coords} kind={kind} crossing={crossing} preview zIndexOffset={450} />
      <Marker
        position={midpoint}
        icon={lengthIcon}
        interactive={false}
        zIndexOffset={500}
      />
    </>
  );
}
