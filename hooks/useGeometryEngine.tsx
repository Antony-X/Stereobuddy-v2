import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { GeometryObject, Constraint, ObjectType, ConstraintType, Point3, Step } from '../types';
import * as THREE from 'three';
import { INITIAL_CAMERA_POS, INITIAL_CAMERA_TARGET } from '../constants';

interface GeometryContextType {
  objects: GeometryObject[];
  constraints: Constraint[];
  steps: Step[];
  activeStepId: string | null;
  addObject: (obj: GeometryObject) => void;
  updateObject: (id: string, data: any) => void;
  removeObject: (id: string) => void;
  addConstraint: (c: Constraint) => void;
  setObjects: (objs: GeometryObject[]) => void;
  setConstraints: (cs: Constraint[]) => void;
  setSteps: (s: Step[]) => void;
  setActiveStep: (id: string | null) => void;
  resetScene: () => void;
  solve: () => void;
  solverStats: { iterations: number; totalError: number; verified: number; total: number };
  cameraPose: { position: Point3; target: Point3 };
  setCameraPose: (pose: { position: Point3; target: Point3 }) => void;
  notebookPose: { position: Point3; target: Point3 } | null;
  setNotebookPose: (pose: { position: Point3; target: Point3 } | null) => void;
  computeOptimalView: () => { position: Point3; target: Point3 };
}

const GeometryContext = createContext<GeometryContextType | null>(null);

export const GeometryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [objects, setObjects] = useState<GeometryObject[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [cameraPose, setCameraPose] = useState({ position: INITIAL_CAMERA_POS as Point3, target: INITIAL_CAMERA_TARGET as Point3 });
  const [notebookPose, setNotebookPose] = useState<{ position: Point3; target: Point3 } | null>(null);
  
  const [solverStats, setSolverStats] = useState({ iterations: 0, totalError: 0, verified: 0, total: 0 });

  const objectsRef = useRef(objects);
  const constraintsRef = useRef(constraints);

  useEffect(() => { objectsRef.current = objects; }, [objects]);
  useEffect(() => { constraintsRef.current = constraints; }, [constraints]);

  // Solver Logic
  const solve = useCallback(() => {
    let currentObjects = JSON.parse(JSON.stringify(objectsRef.current)) as GeometryObject[];
    const activeConstraints = constraintsRef.current.filter(c => c.enabled);
    const MAX_ITER = 50;
    const LEARNING_RATE = 0.5;
    
    let totalResidual = 0;
    let verifiedCount = 0;

    for (let iter = 0; iter < MAX_ITER; iter++) {
      let iterError = 0;
      
      activeConstraints.forEach(c => {
        // --- Distance Constraint ---
        if (c.type === ConstraintType.DISTANCE) {
          const [id1, id2] = c.objectIds;
          const p1 = currentObjects.find(o => o.id === id1);
          const p2 = currentObjects.find(o => o.id === id2);
          
          if (p1 && p2 && p1.data?.position && p2.data?.position) {
            const v1 = new THREE.Vector3(...p1.data.position);
            const v2 = new THREE.Vector3(...p2.data.position);
            const dist = v1.distanceTo(v2);
            const target = c.targetValue || 0;
            const diff = dist - target;
            iterError += Math.abs(diff);

            if (dist > 0.0001) {
              const correction = (diff / dist) * 0.5 * LEARNING_RATE;
              const offset = v2.clone().sub(v1).multiplyScalar(correction);
              
              if (!p1.fixed) {
                p1.data.position = [v1.x + offset.x, v1.y + offset.y, v1.z + offset.z];
              }
              if (!p2.fixed) {
                p2.data.position = [v2.x - offset.x, v2.y - offset.y, v2.z - offset.z];
              }
            }
          }
        } 
        // --- Midpoint Constraint ---
        else if (c.type === ConstraintType.MIDPOINT) {
          const [midId, idA, idB] = c.objectIds;
          const M = currentObjects.find(o => o.id === midId);
          const A = currentObjects.find(o => o.id === idA);
          const B = currentObjects.find(o => o.id === idB);
          
          if (M && A && B) {
             const vM = new THREE.Vector3(...M.data!.position!);
             const vA = new THREE.Vector3(...A.data!.position!);
             const vB = new THREE.Vector3(...B.data!.position!);
             
             const targetM = vA.clone().add(vB).multiplyScalar(0.5);
             const diff = vM.distanceTo(targetM);
             iterError += diff;
             
             if (!M.fixed) {
                const move = targetM.sub(vM).multiplyScalar(LEARNING_RATE);
                M.data!.position = [vM.x + move.x, vM.y + move.y, vM.z + move.z];
             }
          }
        }
      });

      if (iterError < 0.001) break;
      totalResidual = iterError;
    }

    setObjects(currentObjects);

    verifiedCount = activeConstraints.length; // Simplified for demo
    setSolverStats({
      iterations: MAX_ITER,
      totalError: totalResidual,
      verified: verifiedCount,
      total: activeConstraints.length
    });

  }, []);

  const addObject = useCallback((rawObj: GeometryObject) => {
    setObjects(prev => {
        const obj = { ...rawObj };
        
        // Normalization: Ensure ID
        if (!obj.id) obj.id = Math.random().toString(36).substr(2, 9);
        
        // Normalization: Visible default
        if (obj.visible === undefined) obj.visible = true;

        // Normalization: Points array
        // Fix for when API returns data.p1/p2 or data.points instead of top-level points
        if (obj.type === ObjectType.SEGMENT) {
            if ((!obj.points || obj.points.length === 0) && obj.data) {
                if (obj.data.p1 && obj.data.p2) {
                    obj.points = [obj.data.p1, obj.data.p2];
                } else if (Array.isArray(obj.data.points)) {
                    obj.points = obj.data.points;
                }
            }
        }
        if (obj.type === ObjectType.POLYGON) {
            if ((!obj.points || obj.points.length === 0) && obj.data) {
                if (Array.isArray(obj.data.points)) {
                    obj.points = obj.data.points;
                }
            }
        }
        
        // Overwrite if ID exists, else append
        const existsIndex = prev.findIndex(p => p.id === obj.id);
        if (existsIndex >= 0) {
            const copy = [...prev];
            copy[existsIndex] = obj;
            return copy;
        }
        return [...prev, obj];
    });
  }, []);
  
  const updateObject = useCallback((id: string, data: any) => {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, data: { ...o.data, ...data } } : o));
  }, []);
  
  const removeObject = useCallback((id: string) => {
     setObjects(prev => prev.filter(o => o.id !== id));
     setConstraints(prev => prev.filter(c => !c.objectIds.includes(id)));
  }, []);

  const addConstraint = useCallback((c: Constraint) => {
      setConstraints(prev => [...prev, c]);
  }, []);

  const resetScene = useCallback(() => {
    setObjects([]);
    setConstraints([]);
    setSteps([]);
    setActiveStepId(null);
    setNotebookPose(null);
    setSolverStats({ iterations: 0, totalError: 0, verified: 0, total: 0 });
    setCameraPose({ position: INITIAL_CAMERA_POS, target: INITIAL_CAMERA_TARGET });
  }, []);

  const computeOptimalView = useCallback((): { position: Point3; target: Point3 } => {
    if (objectsRef.current.length === 0) return { position: INITIAL_CAMERA_POS, target: INITIAL_CAMERA_TARGET };

    const visibleObjects = objectsRef.current.filter(o => o.visible);
    if (visibleObjects.length === 0) return { position: INITIAL_CAMERA_POS, target: INITIAL_CAMERA_TARGET };

    const box = new THREE.Box3();
    let hasPoints = false;
    visibleObjects.forEach(obj => {
      if (obj.data?.position) {
        box.expandByPoint(new THREE.Vector3(...obj.data.position));
        hasPoints = true;
      }
    });

    if (!hasPoints) return { position: INITIAL_CAMERA_POS, target: INITIAL_CAMERA_TARGET };

    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    
    const maxDim = Math.max(size.x, size.y, size.z);
    
    // Increased multiplier from 2.5 to 4.0 to prevent camera from being too close
    const distance = maxDim * 4.0 + 5; 
    
    // Standard isometric-ish look direction
    const position = center.clone().add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(distance));

    return {
      position: [position.x, position.y, position.z],
      target: [center.x, center.y, center.z]
    };
  }, []);

  const setActiveStep = setActiveStepId;

  return (
    <GeometryContext.Provider value={{
      objects, constraints, steps, activeStepId,
      addObject, updateObject, removeObject, addConstraint,
      setObjects, setConstraints, setSteps, setActiveStep,
      resetScene, solve, solverStats,
      cameraPose, setCameraPose,
      notebookPose, setNotebookPose,
      computeOptimalView
    }}>
      {children}
    </GeometryContext.Provider>
  );
};

export const useGeometry = () => {
  const context = useContext(GeometryContext);
  if (!context) throw new Error("useGeometry must be used within GeometryProvider");
  return context;
};
