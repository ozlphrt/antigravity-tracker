import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

const REF_LAT = 37.0255;
const REF_LNG = 27.4325;

function getCenterCoords(course) {
  if (!course || !course.checkpoints || course.checkpoints.length === 0) {
    return { lat: REF_LAT, lng: REF_LNG };
  }
  const first = course.checkpoints[0];
  if (first.coord) {
    return { lat: first.coord[0], lng: first.coord[1] };
  }
  if (first.coords) {
    return { lat: (first.coords[0][0] + first.coords[1][0]) / 2, lng: (first.coords[0][1] + first.coords[1][1]) / 2 };
  }
  return { lat: REF_LAT, lng: REF_LNG };
}

function latLngToCartesian(lat, lng, center) {
  const x = (lng - center.lng) * 111111 * Math.cos(center.lat * Math.PI / 180);
  const z = -(lat - center.lat) * 111111;
  return { x, z };
}

export default function BoatPwa3D({ course, activePos, aiBoats = [], aiTrails = {}, trace = [], activeTargetIndex = 0 }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);

  // References to keep track of 3D meshes
  const userBoatMeshRef = useRef(null);
  const aiBoatMeshesRef = useRef({}); // { id -> mesh }
  const buoyMeshesRef = useRef([]);
  const lineMeshesRef = useRef([]);
  const trailsGroupRef = useRef(null);
  const targetRingRef = useRef(null);

  // Keep track of the smooth camera position
  const cameraPosRef = useRef(new THREE.Vector3(0, 40, 100));

  // Initialize Three.js Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e0f2fe'); // Soft sky blue
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 2000);
    camera.position.set(0, 40, 100);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 150, 50);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Grid / Water Plane
    const gridHelper = new THREE.GridHelper(2000, 100, '#0284c7', '#0369a1');
    gridHelper.position.y = -0.1;
    scene.add(gridHelper);

    // Large water plane under grid
    const waterGeo = new THREE.PlaneGeometry(3000, 3000);
    const waterMat = new THREE.MeshStandardMaterial({
      color: '#0284c7',
      roughness: 0.2,
      metalness: 0.1,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.2;
    scene.add(water);

    // Trails Group
    const trailsGroup = new THREE.Group();
    scene.add(trailsGroup);
    trailsGroupRef.current = trailsGroup;

    // User Boat outer ring
    const ringGeo = new THREE.RingGeometry(10, 11, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#f26419', side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    scene.add(ring);
    targetRingRef.current = ring;

    // Handle Resize
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Smooth camera transition (LERP)
      if (cameraRef.current && userBoatMeshRef.current) {
        const cam = cameraRef.current;
        const targetPos = cameraPosRef.current;
        
        cam.position.lerp(targetPos, 0.04);
        
        // Lock on user's boat
        const userPos = userBoatMeshRef.current.position;
        cam.lookAt(userPos.x, userPos.y, userPos.z);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement && containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Helper to create a sailboat mesh
  const createSailboat = (colorHex) => {
    const group = new THREE.Group();

    // Hull (cone pointing forward along Z)
    const hullGeo = new THREE.ConeGeometry(3, 12, 4);
    hullGeo.rotateX(Math.PI / 2); // align along Z
    const hullMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.5;
    hull.scale.set(1, 0.5, 1);
    group.add(hull);

    // Mast
    const mastGeo = new THREE.CylinderGeometry(0.15, 0.15, 12, 8);
    const mastMat = new THREE.MeshStandardMaterial({ color: '#4b5563' });
    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.set(0, 6, 1);
    group.add(mast);

    // Main Sail
    const sailGeo = new THREE.ConeGeometry(4, 9, 3);
    sailGeo.scale(0.1, 1, 1);
    const sailMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    const sail = new THREE.Mesh(sailGeo, sailMat);
    sail.position.set(0, 7.5, -1);
    group.add(sail);

    return group;
  };

  // Re-build Course Checkpoints (Buoys / Lines)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !course) return;

    // Clear old buoys/lines
    buoyMeshesRef.current.forEach(m => scene.remove(m));
    buoyMeshesRef.current = [];
    lineMeshesRef.current.forEach(m => scene.remove(m));
    lineMeshesRef.current = [];

    const center = getCenterCoords(course);

    course.checkpoints.forEach((cp, idx) => {
      const isTarget = idx === activeTargetIndex;
      const isBuoy = cp.kind === 'buoy' || cp.type === 'buoy';

      if (isBuoy && cp.coord) {
        const cart = latLngToCartesian(cp.coord[0], cp.coord[1], center);

        // Render Buoy cylinder
        const buoyColor = isTarget ? '#f26419' : (cp.rounding?.toLowerCase() === 'port' ? '#ef4444' : '#22c55e');
        const buoyGeo = new THREE.CylinderGeometry(1.5, 2.0, 6, 16);
        const buoyMat = new THREE.MeshStandardMaterial({ color: buoyColor, roughness: 0.3 });
        const buoy = new THREE.Mesh(buoyGeo, buoyMat);
        buoy.position.set(cart.x, 3, cart.z);
        scene.add(buoy);
        buoyMeshesRef.current.push(buoy);
      } else if (cp.coords) {
        // Line-based (Start / Finish / Gate)
        const ptA = latLngToCartesian(cp.coords[0][0], cp.coords[0][1], center);
        const ptB = latLngToCartesian(cp.coords[1][0], cp.coords[1][1], center);

        // Endpoints buoys
        const buoyGeo = new THREE.CylinderGeometry(1.0, 1.2, 5, 8);
        const buoyMat = new THREE.MeshStandardMaterial({ color: isTarget ? '#f26419' : '#475569', roughness: 0.5 });
        
        const buoyA = new THREE.Mesh(buoyGeo, buoyMat);
        buoyA.position.set(ptA.x, 2.5, ptA.z);
        scene.add(buoyA);
        buoyMeshesRef.current.push(buoyA);

        const buoyB = new THREE.Mesh(buoyGeo, buoyMat);
        buoyB.position.set(ptB.x, 2.5, ptB.z);
        scene.add(buoyB);
        buoyMeshesRef.current.push(buoyB);

        // Connecting dashed line mesh representation
        const path = new THREE.LineCurve3(new THREE.Vector3(ptA.x, 0.1, ptA.z), new THREE.Vector3(ptB.x, 0.1, ptB.z));
        const lineGeo = new THREE.TubeGeometry(path, 20, 0.2, 8, false);
        const lineMat = new THREE.MeshBasicMaterial({ color: isTarget ? '#f26419' : '#94a3b8' });
        const line = new THREE.Mesh(lineGeo, lineMat);
        scene.add(line);
        lineMeshesRef.current.push(line);
      }
    });
  }, [course, activeTargetIndex]);

  // Update Boats & Smooth Camera Target
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !activePos || !course) return;

    const center = getCenterCoords(course);
    const userCart = latLngToCartesian(activePos.lat, activePos.lng, center);

    // 1. User Boat
    if (!userBoatMeshRef.current) {
      const boat = createSailboat('#33658a');
      scene.add(boat);
      userBoatMeshRef.current = boat;
    }
    userBoatMeshRef.current.position.set(userCart.x, 0, userCart.z);
    userBoatMeshRef.current.rotation.y = (activePos.heading * Math.PI) / 180;

    // Adjust target highlight ring
    if (targetRingRef.current) {
      targetRingRef.current.position.set(userCart.x, 0.05, userCart.z);
    }

    // 2. AI Boats
    aiBoats.forEach(boat => {
      const cart = latLngToCartesian(boat.lat, boat.lng, center);
      if (!aiBoatMeshesRef.current[boat.id]) {
        const mesh = createSailboat(boat.color);
        scene.add(mesh);
        aiBoatMeshesRef.current[boat.id] = mesh;
      }
      const mesh = aiBoatMeshesRef.current[boat.id];
      mesh.position.set(cart.x, 0, cart.z);
      mesh.rotation.y = (boat.heading * Math.PI) / 180;
    });

    // Remove any legacy/stale AI boat meshes
    Object.keys(aiBoatMeshesRef.current).forEach(id => {
      if (!aiBoats.find(b => b.id === id)) {
        scene.remove(aiBoatMeshesRef.current[id]);
        delete aiBoatMeshesRef.current[id];
      }
    });

    // 3. Render Trails
    if (trailsGroupRef.current) {
      // Clear old trails
      while (trailsGroupRef.current.children.length > 0) {
        const obj = trailsGroupRef.current.children[0];
        trailsGroupRef.current.remove(obj);
      }

      // Draw User Trail
      if (trace.length > 1) {
        const points = trace.map(p => {
          const cart = latLngToCartesian(p.lat, p.lng, center);
          return new THREE.Vector3(cart.x, 0.1, cart.z);
        });
        const curve = new THREE.CatmullRomCurve3(points);
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(points.length * 2));
        const mat = new THREE.LineBasicMaterial({ color: '#33658a', linewidth: 2 });
        const line = new THREE.Line(geo, mat);
        trailsGroupRef.current.add(line);
      }

      // Draw AI Trails
      Object.entries(aiTrails).forEach(([id, pointsArr]) => {
        if (pointsArr.length > 1) {
          const points = pointsArr.map(p => {
            const cart = latLngToCartesian(p.lat, p.lng, center);
            return new THREE.Vector3(cart.x, 0.1, cart.z);
          });
          const curve = new THREE.CatmullRomCurve3(points);
          const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(points.length * 2));
          const boatColor = aiBoats.find(b => b.id === id)?.color || '#94a3b8';
          const mat = new THREE.LineBasicMaterial({ color: boatColor, linewidth: 1.5 });
          const line = new THREE.Line(geo, mat);
          trailsGroupRef.current.add(line);
        }
      });
    }

    // 4. Update Camera Destination based on current target buoy/checkpoint
    const targets = course.checkpoints.filter(cp => cp.kind === 'start' || cp.kind === 'buoy' || cp.kind === 'gate' || cp.kind === 'finish');
    const activeTarget = targets[activeTargetIndex];
    if (activeTarget) {
      let tX = 0, tZ = 0;
      if (activeTarget.coord) {
        const cart = latLngToCartesian(activeTarget.coord[0], activeTarget.coord[1], center);
        tX = cart.x;
        tZ = cart.z;
      } else if (activeTarget.coords) {
        const lat = (activeTarget.coords[0][0] + activeTarget.coords[1][0]) / 2;
        const lng = (activeTarget.coords[0][1] + activeTarget.coords[1][1]) / 2;
        const cart = latLngToCartesian(lat, lng, center);
        tX = cart.x;
        tZ = cart.z;
      }

      // Position camera 35m behind the buoy along the line of sight, elevated 15m high, looking down at the boat
      const dirX = tX - userCart.x;
      const dirZ = tZ - userCart.z;
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
      
      const camX = tX + (dirX / len) * 35;
      const camZ = tZ + (dirZ / len) * 35;
      
      cameraPosRef.current.set(camX, 15, camZ);
    } else {
      // Default fallback if race is finished
      cameraPosRef.current.set(userCart.x, 30, userCart.z + 60);
    }

  }, [activePos, aiBoats, aiTrails, trace, course, activeTargetIndex]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        height: '100%', 
        position: 'relative', 
        overflow: 'hidden', 
        borderRadius: '16px',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid rgba(255,255,255,0.4)',
        background: '#e0f2fe'
      }} 
    />
  );
}
