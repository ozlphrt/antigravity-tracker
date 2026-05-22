import React from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X } from 'lucide-react'

export default function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ' + r)
    },
    onRegisterError(error) {
      console.log('SW registration error', error)
    },
  })

  const close = () => {
    setNeedRefresh(false)
  }

  if (!needRefresh) return null

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
        A new version of BAYK Tracker is available. Reload to update.
      </p>
      
      <button 
        onClick={() => updateServiceWorker(true)}
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
