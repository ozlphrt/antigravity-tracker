import { useState, useEffect, useRef } from 'react';
import { openDB } from 'idb';
import { supabase } from '../database/mockSupabase';

// Initialize IndexedDB for offline tracking
const initDB = async () => {
  return openDB('bayk_track_cache', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('tracks')) {
        db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
      }
    },
  });
};

export function useGpsTracker(boatId, enabled, onTrackPoint) {
  const [position, setPosition] = useState(null);
  const [offlineQueueSize, setOfflineQueueSize] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const watchId = useRef(null);
  const lastCapturedRef = useRef(null); // for smart-logging in live mode
  const lastHeadingRef = useRef(null);  // keep last known heading across fixes

  // Monitor network status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Attempt sync on start
    if (navigator.onLine) syncOfflineTracks();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Watch position
  useEffect(() => {
    let wakeLock = null;

    const requestWakeLock = async () => {
      if ('wakeLock' in navigator) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
          console.log(`Wake Lock error: ${err.name}`);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (wakeLock !== null && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    if (!enabled) {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      // Reset smart-log state when disabling
      lastCapturedRef.current = null;
      lastHeadingRef.current = null;
      return;
    }

    // Request wake lock when enabled to keep GPS tracking alive
    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        // Use last known heading if GPS heading is unavailable (stationary or low speed)
        const rawHeading = pos.coords.heading;
        const heading = (rawHeading !== null && rawHeading >= 0)
          ? rawHeading
          : (lastHeadingRef.current ?? 0);
        lastHeadingRef.current = heading;

        // Speed: GPS gives m/s, convert to knots
        const speedKnots = (pos.coords.speed || 0) * 1.94384;

        const point = {
          boatId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: speedKnots,
          heading,
          accuracy: pos.coords.accuracy || 0,
          timestamp: pos.timestamp,
        };

        setPosition(point);

        // --- Smart-logging: same algorithm as simulator ---
        const last = lastCapturedRef.current;
        let shouldCapture = false;

        if (!last) {
          shouldCapture = true;
        } else {
          const timeSinceLast = pos.timestamp - last.timestamp;
          let hdgDiff = Math.abs(heading - last.heading);
          if (hdgDiff > 180) hdgDiff = 360 - hdgDiff;

          if (hdgDiff >= 3.0) shouldCapture = true;           // Turning
          else if (timeSinceLast >= 2000) shouldCapture = true; // Heartbeat 2s
        }

        if (shouldCapture) {
          lastCapturedRef.current = point;
          if (onTrackPoint) onTrackPoint(point);
          await saveTrackPoint(point);
        }
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock !== null) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
      }
    };
  }, [enabled, boatId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTrackPoint = async (point) => {
    try {
      const db = await initDB();
      await db.add('tracks', point);
      updateQueueSize(db);
      
      if (isOnline) {
        await syncOfflineTracks();
      }
    } catch (e) {
      console.error("Local save error:", e);
    }
  };

  const syncOfflineTracks = async () => {
    try {
      const db = await initDB();
      const tx = db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      const allPoints = await store.getAll();
      
      if (allPoints.length > 0) {
        const result = await supabase.insertTrackPoints(allPoints);
        if (result.success) {
          await store.clear();
          setOfflineQueueSize(0);
        }
      }
    } catch (e) {
      console.error("Sync error:", e);
    }
  };

  const updateQueueSize = async (db) => {
    if (!db) db = await initDB();
    const count = await db.count('tracks');
    setOfflineQueueSize(count);
  };

  return { position, isOnline, offlineQueueSize };
}
