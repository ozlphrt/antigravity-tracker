import { useEffect, useMemo, useState } from 'react';
import { Marker, useMap } from 'react-leaflet';
import {
  createRaceLineIcon,
  getLineCssRotation,
  getLineMidpoint,
  getLinePixelWidth,
  getRaceLineDimensions,
} from '../utils/raceLine';

const defaultDimensions = { height: 22, border: 3, dotSize: 8, dotInset: 6, arrowSize: 12 };

export default function RaceLineMarker({
  coords,
  kind,
  crossing = 'up',
  interactive = false,
  zIndexOffset = 0,
  preview = false,
  showArrows = true,
  opacity = 1,
}) {
  const map = useMap();
  const [pixelWidth, setPixelWidth] = useState(240);
  const [rotation, setRotation] = useState(0);
  const [dimensions, setDimensions] = useState(defaultDimensions);

  useEffect(() => {
    const update = () => {
      const width = getLinePixelWidth(map, coords);
      setPixelWidth(width);
      setRotation(getLineCssRotation(map, coords));
      setDimensions(getRaceLineDimensions(map, width));
    };
    update();
    map.on('zoom zoomend viewreset resize', update);
    return () => map.off('zoom zoomend viewreset resize', update);
  }, [map, coords]);

  const icon = useMemo(
    () => createRaceLineIcon(kind, rotation, pixelWidth, dimensions, crossing, preview, showArrows),
    [kind, rotation, pixelWidth, dimensions, crossing, preview, showArrows],
  );

  return (
    <Marker
      position={getLineMidpoint(coords)}
      icon={icon}
      interactive={interactive}
      zIndexOffset={zIndexOffset}
      opacity={opacity}
    />
  );
}
