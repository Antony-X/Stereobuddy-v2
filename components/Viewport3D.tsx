// @ts-nocheck
import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { SceneObjects } from './GeometryObjects';
import { useGeometry } from '../hooks/useGeometryEngine';
import { generateNotebookSketch } from '../services/geminiService';

const CameraController = ({ pose, active, onUpdate }: { pose: { position: [number, number, number], target: [number, number, number] }, active: boolean, onUpdate?: () => void }) => {
  const { camera, controls } = useThree();
  const previousPoseRef = useRef<string>("");

  useEffect(() => {
    if (controls && active) {
       const poseKey = JSON.stringify(pose);
       // Only update if pose literally changed to avoid fighting with OrbitControls
       if (poseKey !== previousPoseRef.current) {
          camera.position.set(...pose.position);
          camera.lookAt(...pose.target);
          (controls as any).target.set(...pose.target);
          camera.updateProjectionMatrix();
          (controls as any).update();
          previousPoseRef.current = poseKey;
          onUpdate?.();
       }
    }
  }, [pose, camera, controls, active, onUpdate]);
  return null;
};

// AutoFrame: Watches objects and force-fits camera if no manual pose set
const AutoFrame = () => {
    const { objects, computeOptimalView, setCameraPose, cameraPose } = useGeometry();
    const prevCount = useRef(0);
    const initialized = useRef(false);

    useEffect(() => {
        // Run once on mount or when objects change significantly if we haven't set a pose
        if (objects.length > 0 && (!initialized.current || objects.length !== prevCount.current)) {
            const optimal = computeOptimalView();
            // Only force set if it's the initial load or a reset
            if (!initialized.current) {
                setCameraPose(optimal);
                initialized.current = true;
            }
        }
        prevCount.current = objects.length;
    }, [objects, computeOptimalView, setCameraPose]);

    return null;
}

export const Viewport3D: React.FC = () => {
  const { resetScene, cameraPose, setCameraPose, notebookPose, objects, constraints, computeOptimalView } = useGeometry();
  const [notebookMode, setNotebookMode] = useState(false);
  const [sketchLoading, setSketchLoading] = useState(false);
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);

  // If we have a notebook pose, we can toggle modes
  const handleToggleNotebook = () => {
    setNotebookMode(!notebookMode);
  };

  const handleExport = () => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const link = document.createElement('a');
      link.download = 'geometry-line-art.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  };

  const handleGenerateSketch = async () => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      setSketchLoading(true);
      try {
        const resultUrl = await generateNotebookSketch(dataUrl);
        if (resultUrl) {
            setSketchUrl(resultUrl);
        }
      } catch (e: any) {
        alert(`Sketch generation failed: ${e.message}\n\nEnsure your API Key supports 'gemini-3-pro-image-preview'.`);
      } finally {
        setSketchLoading(false);
      }
    }
  };
  
  const handleOptimalView = () => {
      const optimal = computeOptimalView();
      setCameraPose(optimal);
  };

  // If notebook pose is not set by AI, calculate a default one
  const safeNotebookPose = notebookPose || computeOptimalView();
  const activePose = notebookMode ? safeNotebookPose : cameraPose;

  return (
    <div className={`relative h-full w-full overflow-hidden flex flex-col transition-colors duration-500 ${notebookMode ? 'bg-white' : 'bg-black'}`}>
      {/* Toolbar */}
      <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-start pointer-events-none">
        <div className="pointer-events-auto">
             <button 
                onClick={handleOptimalView}
                className="bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700 hover:text-white px-3 py-1.5 text-xs rounded shadow-lg flex items-center gap-2"
                title="Snap to Best Drawing Angle"
             >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                Best View
             </button>
        </div>

        <div className="pointer-events-auto flex space-x-2">
          <button 
            onClick={handleToggleNotebook} 
            className={`px-3 py-1.5 text-xs rounded border transition font-medium ${notebookMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-800 text-white border-zinc-700 hover:bg-zinc-700'}`}
          >
            {notebookMode ? 'Exit Notebook' : 'Notebook Mode'}
          </button>
          <button onClick={resetScene} className={`px-3 py-1.5 text-xs rounded border transition ${notebookMode ? 'bg-gray-100 text-black border-gray-300 hover:bg-gray-200' : 'bg-zinc-800 text-white border-zinc-700 hover:bg-zinc-700'}`}>
            Reset
          </button>
          <button onClick={handleExport} className={`px-3 py-1.5 text-xs rounded border transition ${notebookMode ? 'bg-gray-100 text-black border-gray-300 hover:bg-gray-200' : 'bg-blue-900/30 text-blue-200 border-blue-800 hover:bg-blue-900/50'}`}>
             Export PNG
          </button>
          <button onClick={handleGenerateSketch} disabled={sketchLoading} className={`px-3 py-1.5 text-xs rounded border transition flex items-center gap-1 ${notebookMode ? 'bg-amber-100 text-amber-900 border-amber-200 hover:bg-amber-200' : 'bg-amber-900/30 text-amber-200 border-amber-800 hover:bg-amber-900/50'}`}>
             {sketchLoading ? 'Generating...' : <span>✏️ AI Sketch</span>}
          </button>
        </div>
      </div>

      {/* SKETCH MODAL OVERLAY */}
      {sketchUrl && (
          <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-8 animate-in fade-in duration-200 backdrop-blur-sm">
              <div className="bg-white p-2 rounded-lg shadow-2xl max-w-4xl max-h-full flex flex-col relative">
                  <div className="flex justify-between items-center p-2 mb-2 border-b">
                      <h3 className="text-black font-bold text-sm">AI Generated Sketch</h3>
                      <div className="flex gap-2">
                          <a href={sketchUrl} download="ai-sketch.png" className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Download</a>
                          <button onClick={() => setSketchUrl(null)} className="px-3 py-1 text-xs bg-gray-200 text-gray-800 rounded hover:bg-gray-300">Close</button>
                      </div>
                  </div>
                  <img src={sketchUrl} className="max-h-[80vh] object-contain border border-gray-100 shadow-inner" alt="AI Sketch" />
              </div>
          </div>
      )}

      {/* 3D Canvas */}
      <Canvas
        shadows
        camera={{ position: [5, 5, 5], fov: 45, near: 0.1, far: 1000 }}
        className="flex-1"
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <AutoFrame />
        <CameraController pose={activePose} active={true} />

        {notebookMode ? (
           <color attach="background" args={['#ffffff']} />
        ) : (
           <color attach="background" args={['#09090b']} />
        )}
        
        {/* Lighting */}
        <ambientLight intensity={notebookMode ? 1 : 0.6} />
        {notebookMode ? (
           <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow={false} />
        ) : (
           <>
            <pointLight position={[10, 10, 10]} intensity={1} />
            <pointLight position={[-10, -10, -5]} intensity={0.5} />
            <Environment preset="city" />
           </>
        )}

        {/* Scene */}
        <group>
            {!notebookMode && <Grid infiniteGrid fadeDistance={50} sectionColor="#27272a" cellColor="#18181b" />}
            <SceneObjects notebookMode={notebookMode} />
        </group>

        {/* Controls */}
        <OrbitControls makeDefault />
      </Canvas>

      {/* Footer Info */}
      <div className={`absolute bottom-2 right-4 text-[10px] font-mono pointer-events-none ${notebookMode ? 'text-gray-400' : 'text-zinc-600'}`}>
        {objects.length} Objects • {constraints.length} Constraints
      </div>
    </div>
  );
};
