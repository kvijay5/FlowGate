'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useTheme } from '../theme/ThemeProvider';

function RotatingModel({ isDark }: { isDark: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const outerMeshRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);

  // Accent and line colors based on theme
  const accentColor = isDark ? '#DC2626' : '#B91C1C';
  const gridColor = isDark ? '#262626' : '#E5E7EB';
  const pointColor = isDark ? '#EF4444' : '#DC2626';

  // Generate constellation point cloud
  const pointPositions = useMemo(() => {
    const count = 350;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const radius = 2.4 + Math.random() * 0.8;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }
    return positions;
  }, []);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.25;
      meshRef.current.rotation.y += delta * 0.35;
    }
    if (outerMeshRef.current) {
      outerMeshRef.current.rotation.x -= delta * 0.15;
      outerMeshRef.current.rotation.y += delta * 0.2;
    }
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.08;
    }
  });

  return (
    <group>
      {/* Core Architectural Polyhedron (Deep Crimson Wireframe) */}
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[1.5, 1]} />
        <meshBasicMaterial wireframe color={accentColor} transparent opacity={0.85} />
      </mesh>

      {/* Outer Gyro Ring (Subtle Architectural Cage) */}
      <mesh ref={outerMeshRef}>
        <dodecahedronGeometry args={[2.2, 0]} />
        <meshBasicMaterial wireframe color={gridColor} transparent opacity={isDark ? 0.35 : 0.45} />
      </mesh>

      {/* Point Cloud Radar / Telemetry Points */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[pointPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.035} color={pointColor} transparent opacity={0.7} sizeAttenuation />
      </points>
    </group>
  );
}

export function WireframeHero() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // SSR / initial hydration placeholder
    return (
      <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
        <div className="w-64 h-64 border border-dashed border-accent/40 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden z-0">
      {/* Radial fade mask so the 3D canvas recedes behind technical HUD metrics */}
      <div className="absolute inset-0 bg-gradient-to-t from-canvas via-transparent to-transparent z-10" />
      <div className="absolute inset-0 bg-gradient-to-r from-canvas via-transparent to-canvas z-10" />

      <Canvas
        camera={{ position: [0, 0, 4.8], fov: 45 }}
        style={{ width: '100%', height: '100%', pointerEvents: 'auto' }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.5} />
        <RotatingModel isDark={isDark} />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.8}
          rotateSpeed={0.5}
        />
      </Canvas>
    </div>
  );
}
