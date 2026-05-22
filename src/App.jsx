import React, { useState } from 'react';
import { Settings, Satellite, X } from 'lucide-react';
import pkg from '../package.json';
import './index.css';

// Mock components to be implemented
import BoatPwaMain from './components/BoatPwa/BoatPwaMain';
import CommitteeMain from './components/Committee/CommitteeMain';
import ReloadPrompt from './components/ReloadPrompt';

function App() {
  const [activeModule, setActiveModule] = useState('boat'); // 'boat' or 'committee'
  const [boatStatus, setBoatStatus] = useState({ state: 'online', queueSize: 0, pointsRecorded: 0, lastSynced: null, resolution: '± 4.2m', collectionStatus: 'Active' });
  const [designedCourse, setDesignedCourse] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showDots, setShowDots] = useState(true);

  const syncedPoints = boatStatus.pointsRecorded - boatStatus.queueSize;
  const statusLabel = (boatStatus.state === 'syncing'
    ? 'SYNCING...'
    : boatStatus.state === 'buffering'
      ? `BUFFERING`
      : 'ONLINE') + ` (${syncedPoints}/${boatStatus.pointsRecorded || 0})`;

  const statusClass = boatStatus.state === 'buffering'
    ? 'offline'
    : boatStatus.state;

  return (
    <div className="app-container">
      <header>
        <div className="brand-block">
          <h1>
            <span>BAYK</span>
            <span className="brand-suffix"> Tracker</span>
          </h1>
          {activeModule === 'boat' && (
            <div className={`header-status ${statusClass}`}>
              <span className="status-dot" />
              <span>{statusLabel}</span>
            </div>
          )}
        </div>
        <div className="module-toggle">
          <button 
            className={activeModule === 'boat' ? 'active' : ''} 
            onClick={() => setActiveModule('boat')}
          >
            Crew
          </button>
          <button 
            className={activeModule === 'committee' ? 'active' : ''} 
            onClick={() => setActiveModule('committee')}
          >
            RC
          </button>
          {activeModule === 'boat' && (
            <button 
              className="icon-action" 
              style={{ padding: '6px', marginLeft: '4px' }}
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Settings"
            >
              <Settings size={20} color="var(--text-secondary)" />
            </button>
          )}
        </div>
      </header>
      
      <main className={activeModule === 'committee' ? 'rc-main' : 'crew-main'}>
        {activeModule === 'boat' ? (
          <BoatPwaMain courseOverride={designedCourse} onStatusChange={setBoatStatus} showDots={showDots} />
        ) : (
          <CommitteeMain courseDraft={designedCourse} onCourseChange={setDesignedCourse} />
        )}
      </main>

      <ReloadPrompt />

      {isSettingsOpen && activeModule === 'boat' && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="modal-content" style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '350px', boxShadow: 'var(--shadow-xl)' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Satellite size={24} color="var(--accent-blue)" />
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Telemetry</h3>
              </div>
              <button type="button" className="icon-action" onClick={() => setIsSettingsOpen(false)}>
                <X size={24} />
              </button>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>GPS Resolution</span>
                <span style={{ fontWeight: 600 }}>{boatStatus.resolution}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Data Collection</span>
                <span style={{ fontWeight: 600, color: boatStatus.collectionStatus === 'Active' ? 'var(--accent-green)' : 'var(--text-primary)' }}>
                  {boatStatus.collectionStatus}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Sync State</span>
                <span style={{ fontWeight: 600 }}>
                  {boatStatus.state === 'online' ? 'Online' : (boatStatus.state === 'syncing' ? 'Syncing...' : `Offline (${boatStatus.queueSize} buffered)`)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Points Recorded</span>
                <span style={{ fontWeight: 600 }}>{boatStatus.pointsRecorded || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px', borderBottom: '1px solid #E2E8F0' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Last Synced</span>
                <span style={{ fontWeight: 600 }}>
                  {boatStatus.lastSynced ? new Date(boatStatus.lastSynced).toLocaleTimeString() : 'Never'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Show Track Dots</span>
                <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
                  <input type="checkbox" checked={showDots} onChange={() => setShowDots(!showDots)} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: showDots ? 'var(--accent-blue)' : '#cbd5e1', transition: '.4s', borderRadius: '22px' }}>
                    <span style={{ position: 'absolute', content: '""', height: '18px', width: '18px', left: '2px', bottom: '2px', backgroundColor: 'white', transition: '.4s', borderRadius: '50%', transform: showDots ? 'translateX(18px)' : 'translateX(0)' }}></span>
                  </span>
                </label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>App Version</span>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>v{pkg.version}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
