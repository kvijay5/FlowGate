'use client';

import React, { Component, ErrorInfo, ReactNode, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useTheme } from '../theme/ThemeProvider';

// =============================================================================
// ERROR BOUNDARY FOR 3D HERO
// Ensures any client WebGL or rendering error never crashes the dashboard
// =============================================================================
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class HeroErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('WireframeHero WebGL error caught by boundary:', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <BrutalistFallbackWireframe />;
    }
    return this.props.children;
  }
}

// =============================================================================
// BRUTALIST 2D SVG FALLBACK
// High-tech geometric wireframe used when WebGL2 is unavailable or headless
// =============================================================================
function BrutalistFallbackWireframe() {
  return (
    <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none select-none">
      <svg
        className="w-72 h-72 animate-[spin_40s_linear_infinite]"
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polygon
          points="100,20 170,60 170,140 100,180 30,140 30,60"
          stroke="currentColor"
          strokeWidth="1"
          className="text-accent"
        />
        <polygon
          points="100,45 150,75 150,125 100,155 50,125 50,75"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 4"
          className="text-line"
        />
        <circle cx="100" cy="100" r="3" fill="currentColor" className="text-accent" />
        <line
          x1="100"
          y1="20"
          x2="100"
          y2="180"
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-line"
        />
        <line
          x1="30"
          y1="60"
          x2="170"
          y2="140"
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-line"
        />
        <line
          x1="30"
          y1="140"
          x2="170"
          y2="60"
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-line"
        />
      </svg>
    </div>
  );
}

// =============================================================================
// WEBGL2 DETECTOR (Three.js r163+ requires WebGL2)
// =============================================================================
function checkWebGL2Support(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      typeof window.WebGL2RenderingContext !== 'undefined' ? canvas.getContext('webgl2') : null;
    return Boolean(gl);
  } catch {
    return false;
  }
}

// =============================================================================
// PURE THREE.JS CANVAS RENDERER
// Direct WebGL2 rendering with zero React reconciler dependencies
// =============================================================================
function PureThreeWireframe({ isDark }: { isDark: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let animId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;

    // Disposables
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    try {
      const gl = canvas.getContext('webgl2');
      if (!gl) {
        return;
      }

      const width = container.clientWidth || 400;
      const height = container.clientHeight || 400;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      camera.position.z = 4.8;

      renderer = new THREE.WebGLRenderer({
        canvas,
        context: gl,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);

      const rootGroup = new THREE.Group();
      scene.add(rootGroup);

      // Colors
      const accentColor = isDark ? 0xdc2626 : 0xb91c1c;
      const cageColor = isDark ? 0x262626 : 0xd1d5db;
      const pointColor = isDark ? 0xef4444 : 0xdc2626;

      // 1. Core Architectural Icosahedron
      const coreGeo = new THREE.IcosahedronGeometry(1.4, 1);
      geometries.push(coreGeo);
      const coreMat = new THREE.MeshBasicMaterial({
        wireframe: true,
        color: accentColor,
        transparent: true,
        opacity: 0.85,
      });
      materials.push(coreMat);
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      rootGroup.add(coreMesh);

      // 2. Outer Dodecahedron Gyro Cage
      const outerGeo = new THREE.DodecahedronGeometry(2.1, 0);
      geometries.push(outerGeo);
      const outerMat = new THREE.MeshBasicMaterial({
        wireframe: true,
        color: cageColor,
        transparent: true,
        opacity: isDark ? 0.35 : 0.45,
      });
      materials.push(outerMat);
      const outerMesh = new THREE.Mesh(outerGeo, outerMat);
      rootGroup.add(outerMesh);

      // 3. Constellation Telemetry Points
      const pointCount = 300;
      const pointPositions = new Float32Array(pointCount * 3);
      for (let i = 0; i < pointCount; i++) {
        const radius = 2.3 + Math.random() * 0.7;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        pointPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        pointPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        pointPositions[i * 3 + 2] = radius * Math.cos(phi);
      }
      const pointsGeo = new THREE.BufferGeometry();
      pointsGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
      geometries.push(pointsGeo);
      const pointsMat = new THREE.PointsMaterial({
        size: 0.035,
        color: pointColor,
        transparent: true,
        opacity: 0.7,
      });
      materials.push(pointsMat);
      const points = new THREE.Points(pointsGeo, pointsMat);
      rootGroup.add(points);

      // Mouse Parallax
      let mouseX = 0;
      let mouseY = 0;
      let targetRotX = 0;
      let targetRotY = 0;

      const handlePointerMove = (e: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const x = (e.clientX - rect.left) / rect.width - 0.5;
          const y = (e.clientY - rect.top) / rect.height - 0.5;
          targetRotY = x * 0.6;
          targetRotX = y * 0.6;
        }
      };

      container.addEventListener('pointermove', handlePointerMove, { passive: true });

      // Resize Observer
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          if (cr.width > 0 && cr.height > 0 && camera && renderer) {
            camera.aspect = cr.width / cr.height;
            camera.updateProjectionMatrix();
            renderer.setSize(cr.width, cr.height);
          }
        }
      });
      resizeObserver.observe(container);

      // Animation Loop
      let lastTime = performance.now();
      const render = (time: number) => {
        const delta = Math.min((time - lastTime) / 1000, 0.1);
        lastTime = time;

        // Rotation
        coreMesh.rotation.x += delta * 0.25;
        coreMesh.rotation.y += delta * 0.35;

        outerMesh.rotation.x -= delta * 0.15;
        outerMesh.rotation.y += delta * 0.2;

        points.rotation.y += delta * 0.08;

        // Smooth mouse parallax damping
        mouseX += (targetRotX - mouseX) * 0.05;
        mouseY += (targetRotY - mouseY) * 0.05;
        rootGroup.rotation.x = mouseX;
        rootGroup.rotation.y = mouseY;

        if (renderer && scene && camera) {
          renderer.render(scene, camera);
        }

        animId = requestAnimationFrame(render);
      };

      animId = requestAnimationFrame(render);

      // Cleanup
      return () => {
        cancelAnimationFrame(animId);
        container.removeEventListener('pointermove', handlePointerMove);
        resizeObserver.disconnect();

        geometries.forEach((g) => g.dispose());
        materials.forEach((m) => m.dispose());

        if (renderer) {
          renderer.dispose();
          renderer.forceContextLoss();
        }
      };
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('Failed to initialize Three.js WebGL scene:', e);
      }
    }
  }, [isDark]);

  return (
    <div ref={containerRef} className="w-full h-full relative pointer-events-auto">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}

// =============================================================================
// MAIN EXPORTED COMPONENT
// =============================================================================
export function WireframeHero() {
  const [mounted, setMounted] = useState(false);
  const [hasWebGL, setHasWebGL] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    setMounted(true);
    setHasWebGL(checkWebGL2Support());
  }, []);

  if (!mounted) {
    return (
      <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
        <div className="w-64 h-64 border border-dashed border-accent/40 animate-pulse" />
      </div>
    );
  }

  return (
    <HeroErrorBoundary>
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden z-0">
        {/* Radial fade mask so the 3D canvas recedes behind technical HUD metrics */}
        <div className="absolute inset-0 bg-gradient-to-t from-canvas via-transparent to-transparent z-10" />
        <div className="absolute inset-0 bg-gradient-to-r from-canvas via-transparent to-canvas z-10" />

        {hasWebGL ? <PureThreeWireframe isDark={isDark} /> : <BrutalistFallbackWireframe />}
      </div>
    </HeroErrorBoundary>
  );
}
