// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Sphere, Html } from '@react-three/drei';
import * as THREE from 'three';
import { GeometryObject, ObjectType } from '../types';
import { useGeometry } from '../hooks/useGeometryEngine';

interface SceneObjectsProps {
  notebookMode?: boolean;
}

// Helper to ensure colors are valid 6-digit hex for Three.js
const sanitizeColor = (color: string | undefined, defaultColor: string): string => {
  if (!color) return defaultColor;
  // If it's an 8-digit hex (includes alpha), strip the alpha
  if (color.startsWith('#') && color.length > 7) {
    return color.substring(0, 7);
  }
  // Validate basic hex format
  if (!/^#[0-9A-F]{6}$/i.test(color)) {
    return defaultColor;
  }
  return color;
};

export const SceneObjects: React.FC<SceneObjectsProps> = ({ notebookMode = false }) => {
  const { objects, activeStepId, steps, updateObject, solve } = useGeometry();

  const activeStep = steps.find(s => s.id === activeStepId);
  const highlightedIds = activeStep ? activeStep.objectIds : [];

  const handleDrag = (id: string, newPos: THREE.Vector3) => {
    updateObject(id, { position: [newPos.x, newPos.y, newPos.z] });
    solve(); 
  };

  return (
    <>
      {objects.map(obj => {
        if (!obj.visible) return null;
        const isHighlighted = highlightedIds.includes(obj.id);
        
        let rawColor = obj.color || (notebookMode ? '#000000' : '#a1a1aa');
        if (isHighlighted) rawColor = '#facc15'; 
        if (notebookMode && !isHighlighted && obj.type !== ObjectType.POLYGON && obj.type !== ObjectType.CIRCLE) rawColor = '#000000';

        const color = sanitizeColor(rawColor, '#a1a1aa');

        switch (obj.type) {
          case ObjectType.POINT:
            return (
              <PointMesh 
                key={obj.id} 
                obj={obj} 
                color={color} 
                isHighlighted={isHighlighted}
                onDrag={(pos) => handleDrag(obj.id, pos)}
                notebookMode={notebookMode}
              />
            );
          case ObjectType.SEGMENT:
            return (
               <SegmentMesh 
                 key={obj.id} 
                 obj={obj} 
                 allObjects={objects} 
                 color={color} 
                 isHighlighted={isHighlighted}
                 notebookMode={notebookMode}
               />
            );
          case ObjectType.POLYGON:
            return (
              <PolygonMesh 
                 key={obj.id} 
                 obj={obj} 
                 allObjects={objects} 
                 color={obj.color ? sanitizeColor(obj.color, '#3b82f6') : (notebookMode ? '#cccccc' : '#3b82f6')} 
                 isHighlighted={isHighlighted}
                 notebookMode={notebookMode}
               />
            );
          case ObjectType.CIRCLE:
             return (
               <CircleMesh
                 key={obj.id}
                 obj={obj}
                 color={color}
                 isHighlighted={isHighlighted}
                 notebookMode={notebookMode}
               />
             );
          default:
            return null;
        }
      })}
    </>
  );
};

interface PointMeshProps {
  obj: GeometryObject;
  color: string;
  isHighlighted: boolean;
  onDrag: (v: THREE.Vector3) => void;
  notebookMode: boolean;
}

const PointMesh: React.FC<PointMeshProps> = ({ obj, color, isHighlighted, onDrag, notebookMode }) => {
  const pos = useMemo(() => new THREE.Vector3(...(obj.data?.position || [0, 0, 0])), [obj.data?.position]);
  const [hovered, setHover] = useState(false);
  const { camera, raycaster } = useThree();
  const [isDragging, setIsDragging] = useState(false);

  const dragPlane = useMemo(() => new THREE.Plane(), []);

  const onPointerDown = (e: any) => {
    if (obj.fixed || notebookMode) return;
    e.stopPropagation();
    setIsDragging(true);
    (e.target as Element).setPointerCapture(e.pointerId);
    
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    dragPlane.setFromNormalAndCoplanarPoint(normal, pos);
  };

  const onPointerUp = (e: any) => {
    setIsDragging(false);
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  const onPointerMove = (e: any) => {
    if (isDragging && !obj.fixed) {
      e.stopPropagation();
      const intersectPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlane, intersectPoint);
      if (intersectPoint) {
        onDrag(intersectPoint);
      }
    }
  };

  return (
    <group position={[pos.x, pos.y, pos.z]}>
      <Sphere 
        args={[isHighlighted ? 0.25 : (notebookMode ? 0.1 : 0.15), 16, 16]} 
        onPointerOver={() => !notebookMode && setHover(true)}
        onPointerOut={() => setHover(false)}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
      >
        <meshStandardMaterial 
          color={isDragging ? '#ffffff' : color} 
          emissive={isHighlighted ? "#facc15" : "#000"} 
          emissiveIntensity={isHighlighted ? 0.8 : 0}
          roughness={0.5}
        />
      </Sphere>
      {(hovered || isHighlighted || isDragging) && (
        <Html position={[0.2, 0.2, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap ${
            isHighlighted 
              ? 'bg-yellow-500 text-black' 
              : (notebookMode ? 'text-black bg-white/80' : 'text-white bg-black/80')
          }`}>
            {obj.name}
          </div>
        </Html>
      )}
    </group>
  );
};

interface SegmentMeshProps {
  obj: GeometryObject;
  allObjects: GeometryObject[];
  color: string;
  isHighlighted: boolean;
  notebookMode: boolean;
}

const SegmentMesh: React.FC<SegmentMeshProps> = ({ obj, allObjects, color, isHighlighted, notebookMode }) => {
  const { p1, p2 } = useMemo(() => {
    // Robust point finding: Check points array first, then data properties
    let p1Id = obj.points?.[0];
    let p2Id = obj.points?.[1];

    if (!p1Id && obj.data?.p1) p1Id = obj.data.p1;
    if (!p2Id && obj.data?.p2) p2Id = obj.data.p2;

    const pt1 = allObjects.find(o => o.id === p1Id);
    const pt2 = allObjects.find(o => o.id === p2Id);
    
    if (!pt1?.data?.position || !pt2?.data?.position) return { p1: null, p2: null };
    
    return {
      p1: new THREE.Vector3(...pt1.data.position),
      p2: new THREE.Vector3(...pt2.data.position)
    };
  }, [obj, allObjects]);

  const curve = useMemo(() => {
     if (!p1 || !p2) return null;
     return new THREE.LineCurve3(p1, p2);
  }, [p1, p2]);

  if (!curve) return null;

  const thickness = isHighlighted ? 0.08 : (notebookMode ? 0.03 : 0.04);

  return (
    <mesh>
      <tubeGeometry args={[curve, 1, thickness, 8, false]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

interface PolygonMeshProps {
  obj: GeometryObject;
  allObjects: GeometryObject[];
  color: string;
  isHighlighted: boolean;
  notebookMode: boolean;
}

const PolygonMesh: React.FC<PolygonMeshProps> = ({ obj, allObjects, color, isHighlighted, notebookMode }) => {
  const { geometry, valid } = useMemo(() => {
    // Robust point finding
    let pointIds = obj.points || [];
    if (pointIds.length === 0 && obj.data?.points) {
        pointIds = obj.data.points;
    }

    const pts = pointIds.map(id => {
      const p = allObjects.find(o => o.id === id);
      return p?.data?.position ? new THREE.Vector3(...p.data.position) : null;
    }).filter(Boolean) as THREE.Vector3[];

    if (pts.length < 3) return { geometry: null, valid: false };

    const geom = new THREE.BufferGeometry();
    const vertices = [];
    // Simple Triangle Fan
    for (let i = 1; i < pts.length - 1; i++) {
      vertices.push(pts[0].x, pts[0].y, pts[0].z);
      vertices.push(pts[i].x, pts[i].y, pts[i].z);
      vertices.push(pts[i+1].x, pts[i+1].y, pts[i+1].z);
    }
    
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.computeVertexNormals();
    return { geometry: geom, valid: true };
  }, [obj, allObjects]);

  if (!valid || !geometry) return null;

  // Visual settings for filled faces
  const opacity = isHighlighted ? 0.9 : (notebookMode ? 0.15 : 0.7);
  const depthWrite = !notebookMode; // Enable depth write for solid feel in 3D mode

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial 
        color={color} 
        transparent 
        opacity={opacity} 
        side={THREE.DoubleSide} 
        depthWrite={depthWrite} 
        roughness={0.4}
        metalness={0.2}
      />
      {isHighlighted && <meshBasicMaterial color="#facc15" wireframe transparent opacity={0.5} />}
    </mesh>
  );
};

interface CircleMeshProps {
  obj: GeometryObject;
  color: string;
  isHighlighted: boolean;
  notebookMode: boolean;
}

const CircleMesh: React.FC<CircleMeshProps> = ({ obj, color, isHighlighted, notebookMode }) => {
    const { pos, norm, rad } = useMemo(() => ({
        pos: new THREE.Vector3(...(obj.data?.position || [0,0,0])),
        norm: new THREE.Vector3(...(obj.data?.normal || [0,1,0])),
        rad: obj.data?.radius || 1
    }), [obj.data]);

    // Create a ring geometry for the outline
    const geometry = useMemo(() => {
        // Create points for a circle on XY plane then rotate
        const curve = new THREE.EllipseCurve(0, 0, rad, rad, 0, 2 * Math.PI, false, 0);
        const pts = curve.getPoints(64);
        const geometry = new THREE.BufferGeometry().setFromPoints(pts);
        return geometry;
    }, [rad]);
    
    // LookAt logic to align circle with normal
    const quaternion = useMemo(() => {
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 0, 1); // EllipseCurve is on XY, so normal is Z
        q.setFromUnitVectors(up, norm.normalize());
        return q;
    }, [norm]);

    return (
        <group position={pos} quaternion={quaternion}>
             <line geometry={geometry}>
                 <lineBasicMaterial color={color} linewidth={isHighlighted ? 3 : 1} />
             </line>
             <mesh>
                 <circleGeometry args={[rad, 32]} />
                 <meshBasicMaterial 
                    color={color} 
                    transparent 
                    opacity={isHighlighted ? 0.2 : 0.05} 
                    side={THREE.DoubleSide}
                    depthWrite={false}
                 />
             </mesh>
        </group>
    );
}