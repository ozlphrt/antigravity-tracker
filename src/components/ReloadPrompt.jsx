import React from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

export default function ReloadPrompt() {
  const [registration, setRegistration] = React.useState(null);
  const [mockRefresh, setMockRefresh] = React.useState(false);
  const [isDismissed, setIsDismissed] = React.useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ' + r)
      if (r) {
        setRegistration(r);
        r.update(); // Initial check on launch
      }
    },
    onRegisterError(error) {
      console.log('SW registration error', error)
    },
  })

  React.useEffect(() => {
    // Force show the update prompt if ?mockUpdate=true is in search or hash parameters
    if (window.location.search.includes('mockUpdate=true') || window.location.hash.includes('mockUpdate=true')) {
      setMockRefresh(true);
    }
  }, []);

  React.useEffect(() => {
    if (!registration) return;

    // Check for updates when window gets focus (user resumes/launches app)
    const checkUpdate = () => {
      // Do not check/trigger if the user has already dismissed the prompt for this session
      if (isDismissed) return;
      registration.update().catch(err => console.error('SW focus update error', err));
    };

    window.addEventListener('focus', checkUpdate);
    document.addEventListener('visibilitychange', checkUpdate);

    // Periodic check every 30 seconds
    const intervalId = setInterval(() => {
      if (isDismissed) return;
      registration.update().catch(err => console.error('SW periodic update error', err));
    }, 30000);

    return () => {
      window.removeEventListener('focus', checkUpdate);
      document.removeEventListener('visibilitychange', checkUpdate);
      clearInterval(intervalId);
    };
  }, [registration, isDismissed]);

  const close = () => {
    setNeedRefresh(false)
    setMockRefresh(false)
    setIsDismissed(true)
  }

  if (isDismissed) return null
  if (!needRefresh && !mockRefresh) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: '120px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: 'var(--bg-panel)',
      color: 'var(--text-primary)',
      padding: '16px',
      borderRadius: '12px',
      boxShadow: 'var(--shadow-xl)',
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      width: '90%',
      maxWidth: '320px',
      border: '1px solid var(--accent-blue)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RefreshCw size={18} color="var(--accent-blue)" />
          Update Available
        </h4>
        <button onClick={close} className="icon-action" style={{ padding: '4px' }}>
          <X size={18} />
        </button>
      </div>
      
      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        A new version of BAYK Tracker is available. {mockRefresh ? 'Reloading will refresh this test page.' : 'Reload to update.'}
      </p>
      
      <button 
        onClick={async () => {
          if (mockRefresh) {
            window.location.reload();
          } else {
            // Trigger skipWaiting
            await updateServiceWorker(true);
            // Fallback reload in case the SW controller change event doesn't fire
            setTimeout(() => {
              window.location.reload();
            }, 1000);
          }
        }}
        style={{
          backgroundColor: 'var(--accent-blue)',
          color: 'white',
          border: 'none',
          padding: '10px',
          borderRadius: '8px',
          fontWeight: 'bold',
          cursor: 'pointer'
        }}
      >
        Reload & Update
      </button>
    </div>
  )
}
