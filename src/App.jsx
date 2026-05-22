import React, { useState } from 'react';
import './index.css';

// Mock components to be implemented
import BoatPwaMain from './components/BoatPwa/BoatPwaMain';
import CommitteeMain from './components/Committee/CommitteeMain';

function App() {
  const [activeModule, setActiveModule] = useState('boat'); // 'boat' or 'committee'
  const [boatStatus, setBoatStatus] = useState({ state: 'online', queueSize: 0 });
  const [designedCourse, setDesignedCourse] = useState(null);

  const statusLabel = boatStatus.state === 'syncing'
    ? 'SYNCING...'
    : boatStatus.state === 'buffering'
      ? `BUFFERING (${boatStatus.queueSize})`
      : 'ONLINE';

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
        </div>
      </header>
      
      <main className={activeModule === 'committee' ? 'rc-main' : 'crew-main'}>
        {activeModule === 'boat' ? (
          <BoatPwaMain courseOverride={designedCourse} onStatusChange={setBoatStatus} />
        ) : (
          <CommitteeMain courseDraft={designedCourse} onCourseChange={setDesignedCourse} />
        )}
      </main>
    </div>
  );
}

export default App;
