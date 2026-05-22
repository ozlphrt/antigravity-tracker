import React from 'react';

const TapeCompass = ({ heading, targetBearing }) => {
  const width = 340;
  const pixelsPerDegree = 6;
  const fovDegrees = width / pixelsPerDegree;
  
  const buffer = 15; // Extra degrees off-screen to prevent popping
  const startDeg = Math.floor(heading - fovDegrees / 2) - buffer;
  const endDeg = Math.ceil(heading + fovDegrees / 2) + buffer;
  
  const ticks = [];
  for (let i = startDeg; i <= endDeg; i++) {
    const displayDeg = (i % 360 + 360) % 360;
    const isMajor = displayDeg % 10 === 0;
    const isMedium = displayDeg % 5 === 0 && !isMajor;
    
    const x = (i - heading) * pixelsPerDegree + width / 2;
    
    ticks.push(
      <div key={i} style={{
        position: 'absolute',
        left: `${x}px`,
        top: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transform: 'translateX(-50%)'
      }}>
        {isMajor && <span style={{ fontSize: '0.9rem', fontWeight: '800', color: 'var(--text-primary)', marginTop: '8px' }}>{displayDeg}</span>}
        <div style={{
          width: isMajor ? '2px' : '1px',
          height: isMajor ? '14px' : (isMedium ? '10px' : '6px'),
          backgroundColor: isMajor ? 'var(--text-primary)' : 'var(--text-secondary)',
          marginTop: 'auto',
          marginBottom: '0',
          borderRadius: '1px'
        }} />
      </div>
    );
  }

  // Target Marker
  let targetX = null;
  if (targetBearing !== null && targetBearing !== undefined) {
    let diff = targetBearing - heading;
    while (diff <= -180) diff += 360;
    while (diff > 180) diff -= 360;
    
    targetX = diff * pixelsPerDegree + width / 2;
  }

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      maxWidth: `${width}px`,
      height: '42px',
      background: 'white',
      overflow: 'hidden',
      borderRadius: '8px',
      border: '1px solid #F1F5F9',
      margin: '0 auto'
    }}>
      {/* Gradient overlays to simulate the curved liquid glass look */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, bottom: 0, width: '40px',
        background: 'linear-gradient(90deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)',
        zIndex: 5
      }}/>
      <div style={{
        position: 'absolute',
        top: 0, right: 0, bottom: 0, width: '40px',
        background: 'linear-gradient(-90deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)',
        zIndex: 5
      }}/>

      {ticks}
      
      {/* Target Marker */}
      {targetBearing !== null && targetBearing !== undefined && (() => {
        let diff = targetBearing - heading;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        
        const isClamped = Math.abs(diff) > 42;
        // Clamp to +/- 42 degrees
        const clampedDiff = Math.max(-42, Math.min(42, diff));
        const left = (clampedDiff * pixelsPerDegree) + (width / 2);
        
        return (
          <div style={{
            position: 'absolute',
            left: `${left}px`,
            top: '0',
            transform: 'translateX(-50%)',
            color: 'var(--accent-coral)',
            opacity: isClamped ? 0.5 : 1.0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            zIndex: 10,
            transition: 'left 0.2s ease-out, opacity 0.2s ease'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L22 20L12 17L2 20L12 2Z" />
            </svg>
          </div>
        );
      })()}
      
      {/* Lubber Line (Center) */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: '3px',
        backgroundColor: 'var(--accent-blue)',
        transform: 'translateX(-50%)',
        zIndex: 10
      }} />
    </div>
  );
};

export default TapeCompass;
