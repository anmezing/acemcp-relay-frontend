"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const GLOBE_RADIUS = 2.35;
const NODE_COUNT = 72;
const NODE_COLORS = ["#57d6c1", "#34d399", "#38bdf8", "#818cf8"];

function createGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create the graph glow texture.");
  }

  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.15, "rgba(255,255,255,0.72)");
  gradient.addColorStop(0.42, "rgba(255,255,255,0.16)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  return new THREE.CanvasTexture(canvas);
}

function createCirclePoints(radius: number, segments = 96) {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  });
}

function createRelationCurve(start: THREE.Vector3, end: THREE.Vector3, radius: number) {
  const from = start.clone().normalize();
  const to = end.clone().normalize();
  const points: THREE.Vector3[] = [];

  for (let index = 0; index <= 18; index += 1) {
    const progress = index / 18;
    const point = from.clone().lerp(to, progress).normalize();
    const lift = radius + 0.035 + Math.sin(progress * Math.PI) * 0.12;
    points.push(point.multiplyScalar(lift));
  }

  return points;
}

export function GraphGlobe() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.1, 8.8);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "graph-globe-canvas";
    renderer.domElement.setAttribute("aria-label", "可拖拽旋转的 LCE 3D 关系图");
    renderer.domElement.setAttribute("role", "img");
    mount.appendChild(renderer.domElement);

    const globe = new THREE.Group();
    scene.add(globe);

    const shellMaterial = new THREE.MeshBasicMaterial({
      color: "#0f3850",
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      wireframe: true,
    });
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS, 32, 20),
      shellMaterial,
    );
    globe.add(shell);

    const atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: "#28b8cf",
      transparent: true,
      opacity: 0.055,
      side: THREE.BackSide,
    });
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.06, 32, 20),
      atmosphereMaterial,
    );
    globe.add(atmosphere);

    const ringMaterial = new THREE.LineBasicMaterial({
      color: "#1b7084",
      transparent: true,
      opacity: 0.2,
    });
    const ringConfigurations = [
      { rotation: new THREE.Euler(0, 0, 0), scale: new THREE.Vector3(1, 0.42, 1) },
      { rotation: new THREE.Euler(Math.PI / 2, 0.18, 0.32), scale: new THREE.Vector3(1, 0.5, 1) },
      { rotation: new THREE.Euler(0.7, 0.5, 1.25), scale: new THREE.Vector3(1, 0.31, 1) },
    ];

    ringConfigurations.forEach(({ rotation, scale }) => {
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(createCirclePoints(GLOBE_RADIUS * 1.015)),
        ringMaterial,
      );
      ring.rotation.copy(rotation);
      ring.scale.copy(scale);
      globe.add(ring);
    });

    const nodePositions: THREE.Vector3[] = [];
    const nodeObjects: THREE.Object3D[] = [];
    const nodeGeometry = new THREE.SphereGeometry(0.043, 8, 8);
    const glowTexture = createGlowTexture();

    for (let index = 0; index < NODE_COUNT; index += 1) {
      const y = 1 - (index / (NODE_COUNT - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = Math.PI * (3 - Math.sqrt(5)) * index;
      const position = new THREE.Vector3(
        Math.cos(theta) * radiusAtY,
        y,
        Math.sin(theta) * radiusAtY,
      ).multiplyScalar(GLOBE_RADIUS + 0.035);
      nodePositions.push(position);

      const color = NODE_COLORS[index % NODE_COLORS.length];
      const nodeMaterial = new THREE.MeshBasicMaterial({ color });
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      node.position.copy(position);
      node.userData.phase = (index * 0.79) % (Math.PI * 2);
      node.userData.baseScale = 0.82 + (index % 4) * 0.08;
      globe.add(node);
      nodeObjects.push(node);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          color,
          depthWrite: false,
          map: glowTexture,
          opacity: 0.48,
          transparent: true,
        }),
      );
      glow.position.copy(position);
      glow.scale.setScalar(0.27 + (index % 3) * 0.035);
      globe.add(glow);
    }

    const lineMaterials: THREE.LineBasicMaterial[] = [];
    const dashedMaterials: THREE.LineDashedMaterial[] = [];
    const relationEdges = new Set<string>();
    const addRelation = (fromIndex: number, toIndex: number, highlighted = false) => {
      const low = Math.min(fromIndex, toIndex);
      const high = Math.max(fromIndex, toIndex);
      const key = `${low}:${high}`;
      if (relationEdges.has(key)) return;
      relationEdges.add(key);

      const material = highlighted
        ? new THREE.LineDashedMaterial({
            color: "#57d6c1",
            dashSize: 0.14,
            gapSize: 0.1,
            opacity: 0.68,
            transparent: true,
          })
        : new THREE.LineBasicMaterial({
            color: "#23879a",
            opacity: 0.28,
            transparent: true,
          });

      const relation = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          createRelationCurve(nodePositions[fromIndex], nodePositions[toIndex], GLOBE_RADIUS),
        ),
        material,
      );
      relation.frustumCulled = false;
      relation.renderOrder = highlighted ? 2 : 1;
      globe.add(relation);

      if (highlighted && material instanceof THREE.LineDashedMaterial) {
        relation.computeLineDistances();
        dashedMaterials.push(material);
      } else if (material instanceof THREE.LineBasicMaterial) {
        lineMaterials.push(material);
      }
    };

    for (let index = 0; index < NODE_COUNT; index += 1) {
      const nearest = nodePositions
        .map((position, candidateIndex) => ({
          candidateIndex,
          distance: nodePositions[index].distanceToSquared(position),
        }))
        .filter(({ candidateIndex }) => candidateIndex !== index)
        .sort((left, right) => left.distance - right.distance)
        .slice(0, 2);

      nearest.forEach(({ candidateIndex }) => addRelation(index, candidateIndex));
    }

    for (let index = 0; index < 14; index += 1) {
      const fromIndex = (index * 11) % NODE_COUNT;
      const toIndex = (fromIndex + 13 + (index % 4) * 7) % NODE_COUNT;
      addRelation(fromIndex, toIndex, index % 2 === 0);
    }

    const starPositions = new Float32Array(180 * 3);
    for (let index = 0; index < starPositions.length; index += 3) {
      const distance = 4.6 + Math.random() * 3.2;
      const direction = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize();
      starPositions[index] = direction.x * distance;
      starPositions[index + 1] = direction.y * distance;
      starPositions[index + 2] = direction.z * distance;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: "#5d9bb2",
        size: 0.026,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.5,
      }),
    );
    scene.add(stars);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = 0.55;
    controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.autoRotateSpeed = 0.35;
    controls.target.set(0, 0, 0);
    renderer.domElement.style.touchAction = "pan-y";

    const timer = new THREE.Timer();
    timer.connect(document);
    let animationFrame = 0;

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const animate = (timestamp: number) => {
      animationFrame = window.requestAnimationFrame(animate);
      timer.update(timestamp);
      const elapsed = timer.getElapsed();

      nodeObjects.forEach((node) => {
        const phase = Number(node.userData.phase);
        const baseScale = Number(node.userData.baseScale);
        const pulse = baseScale * (1 + Math.sin(elapsed * 1.25 + phase) * 0.12);
        node.scale.setScalar(pulse);
      });

      dashedMaterials.forEach((material, index) => {
        material.opacity = 0.48 + Math.sin(elapsed * 1.4 + index * 0.7) * 0.16;
      });
      stars.rotation.y = elapsed * 0.004;
      controls.update();
      renderer.render(scene, camera);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      timer.dispose();
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      glowTexture.dispose();
      nodeGeometry.dispose();
      starGeometry.dispose();

      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineLoop) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
        if (object instanceof THREE.Sprite) {
          object.material.dispose();
        }
      });

      renderer.domElement.remove();
      lineMaterials.length = 0;
      dashedMaterials.length = 0;
    };
  }, []);

  return (
    <div ref={mountRef} className="graph-globe-root">
      <div className="graph-globe-vignette" aria-hidden="true" />
      <div className="graph-globe-hint" aria-hidden="true">
        <span className="graph-globe-hint-dot" />
        拖拽旋转
      </div>
    </div>
  );
}
