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

export function useGpsTracker(boatId, enabled) {
  const [position, setPosition] = useState(null);
  const [offlineQueueSize, setOfflineQueueSize] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const watchId = useRef(null);

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
    if (!enabled) {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      return;
    }

    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const point = {
          boatId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed || 0, // meters/sec
          heading: pos.coords.heading || 0, // degrees
          accuracy: pos.coords.accuracy || 0, // meters
          timestamp: pos.timestamp,
        };

        setPosition(point);
        await saveTrackPoint(point);
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, [enabled, boatId]);

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
