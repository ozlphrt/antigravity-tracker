import React, { useState, useRef } from 'react';
import { Trash2, Copy, GripHorizontal, MapPin, Ruler } from 'lucide-react';
import { normalizeLineCrossing, getLineLengthMeters, formatLineLength } from '../../utils/raceLine';

const POPUP_WIDTH = 240;
const POPUP_HEIGHT_ESTIMATE = 280; // conservative estimate for clamping
const MARGIN = 12;

const lineKindLabel = { start: 'Start Line', gate: 'Gate', finish: 'Finish Line' };

const formatCoord = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(6) : '');
const parseCoord = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

function clampedPopupStyle(screenX, screenY, containerW, containerH) {
  let left = screenX - POPUP_WIDTH / 2;
  // Default to 60px below the element to avoid blocking horizontal lines
  let top = screenY + 60;

  // If not enough room below, flip to above
  if (top + POPUP_HEIGHT_ESTIMATE > containerH - MARGIN) {
    top = screenY - POPUP_HEIGHT_ESTIMATE - 60;
  }

  // Horizontal clamp
  if (left < MARGIN) left = MARGIN;
  if (left + POPUP_WIDTH > containerW - MARGIN) left = containerW - POPUP_WIDTH - MARGIN;

  // Vertical clamp just in case
  if (top < MARGIN) top = MARGIN;

  return { left, top };
}

export default function ElementPopup({
  checkpoint,
  screenX,
  screenY,
  containerW,
  containerH,
  onUpdateRounding,
  onUpdateLineKind,
  onUpdateLineCrossing,
  onUpdateBuoyCoord,
  onUpdateLineCoord,
  onRemove,
}) {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showCoords, setShowCoords] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  if (!checkpoint || screenX == null || screenY == null) return null;

  const { left, top } = clampedPopupStyle(screenX, screenY, containerW, containerH);
  
  // Apply drag offset
  const finalLeft = left + dragOffset.x;
  const finalTop = top + dragOffset.y;

  const isBuoy = checkpoint.kind === 'buoy';
  const crossing = normalizeLineCrossing(checkpoint.crossing);

  const handlePointerDown = (e) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
    e.target.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const handlePointerMove = (e) => {
    if (!isDragging.current) return;
    setDragOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
    e.stopPropagation();
  };

  const handlePointerUp = (e) => {
    isDragging.current = false;
    e.target.releasePointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const copyCoords = (lat, lng) => {
    navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
  };

  return (
    <div
      className="rc-element-popup"
      style={{ left: finalLeft, top: finalTop }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div 
        className="rc-popup-header" 
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: 'grab', touchAction: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <GripHorizontal size={16} color="#94a3b8" />
          <div>
            <div className="rc-popup-id">{checkpoint.id}</div>
            <div className="rc-popup-kind">
              {isBuoy ? 'Buoy Mark' : lineKindLabel[checkpoint.kind]}
              {!isBuoy && checkpoint.coords && (
                <span style={{ marginLeft: '6px', color: 'var(--text-secondary)', fontWeight: 400, fontSize: '0.78rem' }}>
                  ({formatLineLength(getLineLengthMeters(checkpoint.coords))})
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            className={`rc-popup-icon-btn${showCoords ? ' active' : ''}`}
            title="Toggle Coordinates"
            onClick={(e) => {
               e.stopPropagation();
               setShowCoords((v) => !v);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ color: showCoords ? 'var(--primary)' : 'var(--text-secondary)' }}
          >
            <MapPin size={15} />
          </button>
          <button
            type="button"
            className="rc-popup-delete"
            title={`Delete ${checkpoint.id}`}
            onClick={(e) => {
               e.stopPropagation();
               onRemove(checkpoint.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="rc-popup-divider" />

      {/* Buoy: turn direction */}
      {isBuoy && (
        <div className="rc-popup-section">
          <div className="rc-popup-label">Turn Direction</div>
          <div className="segmented-control wide" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className={checkpoint.rounding === 'port' ? 'active' : ''}
              onClick={() => onUpdateRounding(checkpoint.id, 'port')}
            >
              Port
            </button>
            <button
              type="button"
              className={checkpoint.rounding === 'starboard' ? 'active' : ''}
              onClick={() => onUpdateRounding(checkpoint.id, 'starboard')}
            >
              Starboard
            </button>
          </div>
        </div>
      )}

      {/* Line: type + crossing */}
      {!isBuoy && (
        <>
          <div className="rc-popup-section">
            <div className="rc-popup-label">Line Type</div>
            <div className="segmented-control wide" style={{ marginBottom: 0 }}>
              {['start', 'gate', 'finish'].map((k) => (
                <button
                  key={k}
                  type="button"
                  className={checkpoint.kind === k ? 'active' : ''}
                  onClick={() => onUpdateLineKind(checkpoint.id, k)}
                  style={{ fontSize: '0.78rem' }}
                >
                  {lineKindLabel[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="rc-popup-section">
            <div className="rc-popup-label">Crossing Direction</div>
            <div className="segmented-control wide" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className={crossing === 'up' ? 'active' : ''}
                onClick={() => onUpdateLineCrossing(checkpoint.id, 'up')}
              >
                Up
              </button>
              <button
                type="button"
                className={crossing === 'down' ? 'active' : ''}
                onClick={() => onUpdateLineCrossing(checkpoint.id, 'down')}
              >
                Down
              </button>
            </div>
          </div>
        </>
      )}

      {showCoords && (
        <>
          <div className="rc-popup-divider" />
          
          {/* Coordinates */}
          <div className="rc-popup-section">
            <div className="rc-popup-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Coordinates</span>
              {isBuoy && (
                <button type="button" className="rc-popup-icon-btn" onClick={() => copyCoords(checkpoint.coord[0], checkpoint.coord[1])} title="Copy Lat/Lng">
                  <Copy size={13} />
                </button>
              )}
            </div>

            {isBuoy ? (
              <div className="rc-popup-coords">
                <div>
                  <div className="rc-popup-coord-label">Lat</div>
                  <input
                    type="number"
                    step="0.000001"
                    className="rc-popup-coord-input"
                    value={formatCoord(checkpoint.coord[0])}
                    onChange={(e) => onUpdateBuoyCoord(checkpoint.id, 0, parseCoord(e.target.value, checkpoint.coord[0]))}
                  />
                </div>
                <div>
                  <div className="rc-popup-coord-label">Lng</div>
                  <input
                    type="number"
                    step="0.000001"
                    className="rc-popup-coord-input"
                    value={formatCoord(checkpoint.coord[1])}
                    onChange={(e) => onUpdateBuoyCoord(checkpoint.id, 1, parseCoord(e.target.value, checkpoint.coord[1]))}
                  />
                </div>
              </div>
            ) : (
              <>
                {[0, 1].map((pi) => (
                  <React.Fragment key={pi}>
                    <div className="rc-popup-coord-label" style={{ marginTop: pi === 0 ? 0 : 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Point {pi === 0 ? 'A' : 'B'}</span>
                      <button type="button" className="rc-popup-icon-btn" onClick={() => copyCoords(checkpoint.coords[pi][0], checkpoint.coords[pi][1])} title="Copy Lat/Lng">
                        <Copy size={12} />
                      </button>
                    </div>
                    <div className="rc-popup-coords">
                      <div>
                        <div className="rc-popup-coord-label" style={{ marginTop: 0 }}>Lat</div>
                        <input
                          type="number"
                          step="0.000001"
                          className="rc-popup-coord-input"
                          value={formatCoord(checkpoint.coords[pi][0])}
                          onChange={(e) => onUpdateLineCoord(checkpoint.id, pi, 0, parseCoord(e.target.value, checkpoint.coords[pi][0]))}
                        />
                      </div>
                      <div>
                        <div className="rc-popup-coord-label" style={{ marginTop: 0 }}>Lng</div>
                        <input
                          type="number"
                          step="0.000001"
                          className="rc-popup-coord-input"
                          value={formatCoord(checkpoint.coords[pi][1])}
                          onChange={(e) => onUpdateLineCoord(checkpoint.id, pi, 1, parseCoord(e.target.value, checkpoint.coords[pi][1]))}
                        />
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
