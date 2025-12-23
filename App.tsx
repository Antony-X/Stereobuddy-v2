import React from 'react';
import { GeometryProvider } from './hooks/useGeometryEngine';
import { ChatPanel } from './components/ChatPanel';
import { Viewport3D } from './components/Viewport3D';

const App: React.FC = () => {
  return (
    <GeometryProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-dark text-white font-sans">
        <ChatPanel />
        <main className="flex-1 relative">
          <Viewport3D />
        </main>
      </div>
    </GeometryProvider>
  );
};

export default App;
