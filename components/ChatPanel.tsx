import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ChatMessage, ActionPayload, GeometryObject, ObjectType, ConstraintType } from '../types';
import { useGeometry } from '../hooks/useGeometryEngine';
import { generateGeometryAction, narrateText } from '../services/geminiService';

export const ChatPanel: React.FC = () => {
  const { 
    addObject, addConstraint, setSteps, setActiveStep, activeStepId, steps,
    setCameraPose, setObjects, setConstraints, resetScene, setNotebookPose, objects, updateObject
  } = useGeometry();

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [thoughtSig, setThoughtSig] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{ raw: string, parsed: any, error?: string } | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [pendingImages, setPendingImages] = useState<{ mimeType: string, data: string }[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [stepsCollapsed, setStepsCollapsed] = useState(false);
  
  // Voice Walkthrough State
  const [playerState, setPlayerState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const playbackIndexRef = useRef<number>(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(scrollToBottom, [messages]);

  // --- AUDIO ENGINE ---

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  // Prefetch audio when steps change
  useEffect(() => {
    if (steps.length === 0) return;
    
    // Initialize context silently to allow decoding
    const ctx = initAudioContext();
    
    steps.forEach(async (step) => {
        if (!audioCacheRef.current.has(step.id)) {
            try {
                // Fetch PCM
                const pcmData = await narrateText(step.description);
                if (pcmData) {
                    // Decode to AudioBuffer
                    const dataInt16 = new Int16Array(pcmData.buffer);
                    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
                    const channelData = buffer.getChannelData(0);
                    for (let i = 0; i < dataInt16.length; i++) {
                        channelData[i] = dataInt16[i] / 32768.0;
                    }
                    audioCacheRef.current.set(step.id, buffer);
                }
            } catch (e) {
                // Silently fail on prefetch
            }
        }
    });
  }, [steps]);

  const playStepAudio = (stepIndex: number) => {
      const ctx = initAudioContext();
      if (stepIndex >= steps.length) {
          setPlayerState('stopped');
          playbackIndexRef.current = 0;
          return;
      }

      const step = steps[stepIndex];
      setActiveStep(step.id);
      
      // Update Camera smoothly if provided
      if (step.cameraView) {
          setCameraPose({ position: step.cameraView, target: [0,0,0] });
      }

      // Check Cache
      const buffer = audioCacheRef.current.get(step.id);
      
      if (buffer) {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          
          source.onended = () => {
              // Only proceed if we are still 'playing' (not stopped)
              // Note: suspend() pauses the time, so onended doesn't fire.
              if (audioContextRef.current?.state === 'running') {
                  playbackIndexRef.current = stepIndex + 1;
                  playStepAudio(stepIndex + 1);
              }
          };
          
          activeSourceRef.current = source;
          source.start(0);
      } else {
          // If audio not ready, just wait a bit and move on
          setTimeout(() => {
              if (playerState !== 'stopped') {
                 playbackIndexRef.current = stepIndex + 1;
                 playStepAudio(stepIndex + 1);
              }
          }, 2000);
      }
  };

  const togglePlayback = async () => {
      const ctx = initAudioContext();
      
      if (playerState === 'stopped') {
          // Start from beginning or current active
          await ctx.resume();
          let startIndex = steps.findIndex(s => s.id === activeStepId);
          if (startIndex === -1) startIndex = 0;
          playbackIndexRef.current = startIndex;
          
          setPlayerState('playing');
          playStepAudio(startIndex);
      } else if (playerState === 'playing') {
          // Pause
          await ctx.suspend();
          setPlayerState('paused');
      } else if (playerState === 'paused') {
          // Resume
          await ctx.resume();
          setPlayerState('playing');
      }
  };

  const stopPlayback = () => {
      if (activeSourceRef.current) {
          try { activeSourceRef.current.stop(); } catch(e) {}
      }
      setPlayerState('stopped');
      playbackIndexRef.current = 0;
  };

  // --- HANDLERS ---

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            const match = base64.match(/^data:(.*);base64,(.*)$/);
            if (match) {
               setPendingImages(prev => [...prev, { mimeType: match[1], data: match[2] }]);
            }
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (evt) => {
            const base64 = evt.target?.result as string;
            const match = base64.match(/^data:(.*);base64,(.*)$/);
            if (match) {
                setPendingImages(prev => [...prev, { mimeType: match[1], data: match[2] }]);
                setShowActions(false);
            }
        };
        reader.readAsDataURL(file);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || loading) return;

    // Reset audio state on new prompt
    stopPlayback();
    audioCacheRef.current.clear();

    const currentImages = [...pendingImages];
    const userMsg: ChatMessage = { 
        id: Date.now().toString(), 
        role: 'user', 
        content: input, 
        attachments: currentImages,
        timestamp: Date.now() 
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setPendingImages([]);
    setLoading(true);
    setDebugInfo(null);
    setShowActions(false);

    try {
      const history = messages.map(m => ({ 
          role: m.role, 
          parts: [
              { text: m.content },
              ...(m.attachments?.map(a => ({ inlineData: { mimeType: a.mimeType, data: a.data } })) || [])
          ] 
      }));
      
      const response = await generateGeometryAction(userMsg.content, history, currentImages, thoughtSig);
      
      setDebugInfo({ raw: response.rawText || "", parsed: response.json });

      const aiMsg: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        role: 'model', 
        content: response.text, 
        timestamp: Date.now() 
      };
      
      setMessages(prev => [...prev, aiMsg]);

      // Execute Actions
      if (response.json?.messageType === 'actions') {
        const payload = response.json as ActionPayload;
        if (payload.thoughtSignature) setThoughtSig(payload.thoughtSignature);

        if (payload.actions) {
          if (payload.actions.some(a => a.type === 'resetScene')) {
             resetScene();
          }

          payload.actions.forEach(action => {
            try {
                switch(action.type) {
                case 'addObject': addObject(action.payload); break;
                case 'updateObject': if (action.payload.id) updateObject(action.payload.id, action.payload.data); break;
                case 'addConstraint': addConstraint(action.payload); break;
                case 'setCamera': setCameraPose(action.payload); break;
                case 'setNotebookView': setNotebookPose(action.payload); break;
                case 'resetScene': break;
                }
            } catch (err) {
                console.warn("Action failed:", action, err);
            }
          });
        }
        
        if (payload.stepList && payload.stepList.length > 0) {
          setSteps(payload.stepList);
          setActiveStep(payload.stepList[0].id);
          setStepsCollapsed(false); 
        }
      }
    } catch (e: any) {
      console.error(e);
      setDebugInfo({ raw: "", parsed: {}, error: e.message });
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', content: "Sorry, I encountered an error. Check the Debug Panel.", timestamp: Date.now() }]);
    } finally {
      setLoading(false);
    }
  };

  const handleMic = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert("Speech recognition not supported in this browser.");
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    
    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => {
        setIsRecording(false);
        setShowActions(false);
    };
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + ' ' + transcript);
    };
    recognition.start();
  };

  const narrate = async (text: string) => {
     if (playerState !== 'stopped') stopPlayback();
     const pcmData = await narrateText(text);
     if (pcmData) {
         const ctx = initAudioContext();
         const dataInt16 = new Int16Array(pcmData.buffer);
         const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
         const channelData = buffer.getChannelData(0);
         for (let i = 0; i < dataInt16.length; i++) {
            channelData[i] = dataInt16[i] / 32768.0;
         }
         const source = ctx.createBufferSource();
         source.buffer = buffer;
         source.connect(ctx.destination);
         source.start(0);
     }
  };

  return (
    <div className="flex flex-col h-full bg-panel border-r border-border max-w-md min-w-[350px]">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-4 opacity-70">
                {/* Custom StereoBuddy SVG Logo */}
                <div className="w-24 h-24 flex items-center justify-center mb-2">
                    <svg width="800" height="800" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                        <defs>
                            <style>{`.shape-fill { fill: #e6e3da; } .shape-outline { stroke: #1d1d1b; stroke-width: 24; stroke-linejoin: round; stroke-linecap: round; }`}</style>
                        </defs>
                        <polygon points="100,430 350,520 700,380 450,290" className="shape-fill shape-outline" />
                        <polygon points="360,150 600,215 495,650 255,585" className="shape-fill shape-outline" />
                        <path d="M 100 430 L 350 520 L 700 380" fill="none" className="shape-outline" />
                    </svg>
                </div>
                <div className="text-center">
                    <p className="font-medium text-zinc-400">Welcome to StereoBuddy</p>
                    <p className="text-xs text-zinc-500 mt-1">Try "Construct a triangular prism"</p>
                </div>
            </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] p-3 rounded-2xl text-sm shadow-sm ${m.role === 'user' ? 'bg-accent text-white rounded-br-none' : 'bg-zinc-800 text-zinc-200 rounded-bl-none border border-zinc-700'}`}>
              {m.attachments && m.attachments.length > 0 && (
                  <div className="flex gap-2 mb-2">
                      {m.attachments.map((att, i) => (
                          <img key={i} src={`data:${att.mimeType};base64,${att.data}`} className="w-16 h-16 object-cover rounded border border-white/20" />
                      ))}
                  </div>
              )}
              
              <div className={`prose prose-sm max-w-none [&>*:last-child]:mb-0 ${
                  m.role === 'user' 
                    ? 'text-white prose-headings:text-white prose-p:text-white prose-strong:text-white prose-a:text-white prose-code:text-white prose-code:bg-white/20 prose-ol:text-white prose-ul:text-white' 
                    : 'prose-invert'
                }`}>
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {m.content}
                  </ReactMarkdown>
              </div>

              {m.role === 'model' && (
                  <button onClick={() => narrate(m.content)} className="mt-2 text-[10px] uppercase tracking-wider opacity-40 hover:opacity-100 flex items-center gap-1">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/></svg>
                     Read
                  </button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 px-4 py-3 rounded-2xl rounded-bl-none flex items-center space-x-1.5 border border-zinc-700">
              <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" />
              <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce delay-75" />
              <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce delay-150" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {steps.length > 0 && (
        <div className={`border-t border-border bg-zinc-900 flex flex-col transition-all duration-300 ${stepsCollapsed ? 'h-10' : 'h-1/3'}`}>
           <div 
             className="flex items-center justify-between p-2.5 bg-zinc-800 cursor-pointer hover:bg-zinc-700/80 transition"
             onClick={(e) => {
                 if ((e.target as HTMLElement).closest('button')) return;
                 setStepsCollapsed(!stepsCollapsed);
             }}
           >
             <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
               <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
               Steps ({steps.length})
             </span>
             <div className="flex items-center gap-2">
                 <button 
                    onClick={togglePlayback}
                    className={`p-1 rounded hover:bg-zinc-600 transition ${playerState === 'playing' ? 'text-accent' : (playerState === 'paused' ? 'text-yellow-400' : 'text-zinc-400 hover:text-white')}`}
                    title={playerState === 'playing' ? "Pause" : "Play Solution"}
                 >
                    {playerState === 'playing' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    )}
                 </button>
                 <svg 
                   className={`w-4 h-4 text-zinc-500 transform transition ${stepsCollapsed ? 'rotate-180' : ''}`}
                   viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 >
                   <polyline points="6 9 12 15 18 9"/>
                 </svg>
             </div>
           </div>
           
           <div className={`flex-1 overflow-y-auto ${stepsCollapsed ? 'hidden' : 'block'}`}>
             {steps.map((step, idx) => (
               <div 
                 key={step.id}
                 onClick={() => setActiveStep(step.id)}
                 className={`p-3 border-b border-zinc-800 cursor-pointer hover:bg-zinc-800/50 transition flex items-start gap-3 group ${activeStepId === step.id ? 'bg-blue-900/10' : ''}`}
               >
                 <span className={`text-xs font-mono mt-0.5 ${activeStepId === step.id ? 'text-accent' : 'text-zinc-600'}`}>{idx + 1}.</span>
                 <p className={`text-sm leading-relaxed ${activeStepId === step.id ? 'text-blue-100' : 'text-zinc-400 group-hover:text-zinc-300'}`}>{step.description}</p>
               </div>
             ))}
           </div>
        </div>
      )}

      {/* COMPACT INPUT AREA */}
      <div className="p-2 border-t border-border bg-panel">
        {pendingImages.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-2">
                {pendingImages.map((img, i) => (
                    <div key={i} className="relative group shrink-0">
                        <img src={`data:${img.mimeType};base64,${img.data}`} className="h-10 w-10 object-cover rounded border border-zinc-700" />
                        <button 
                            onClick={() => setPendingImages(prev => prev.filter((_, idx) => idx !== i))}
                            className="absolute -top-1 -right-1 bg-zinc-900 text-zinc-400 hover:text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] border border-zinc-700"
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
        )}
        
        <div className="flex items-end gap-2 relative">
           {/* Plus Menu */}
           <div className="relative mb-0.5">
             {showActions && (
               <div className="absolute bottom-10 left-0 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-1 mb-2 flex flex-col gap-1 min-w-[120px] animate-in fade-in slide-in-from-bottom-2 duration-200 z-50">
                   <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white rounded text-left transition">
                       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                       Attach Image
                   </button>
                   <button onClick={handleMic} className={`flex items-center gap-2 px-3 py-2 text-sm rounded text-left transition ${isRecording ? 'bg-red-900/30 text-red-400' : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'}`}>
                       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                       {isRecording ? 'Listening...' : 'Voice Input'}
                   </button>
               </div>
             )}
             <button 
                onClick={() => setShowActions(!showActions)}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition border ${showActions ? 'bg-zinc-700 text-white border-zinc-600' : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'}`}
             >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
             </button>
           </div>
           
           <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-2xl py-1.5 px-4 text-sm text-white resize-none focus:outline-none focus:border-accent min-h-[36px] max-h-24 leading-relaxed"
            style={{ height: '36px' }}
            onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 96) + 'px';
            }}
           />
           
           <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileSelect} />
           
           <button 
              onClick={handleSend}
              disabled={loading || (!input.trim() && pendingImages.length === 0)}
              className="w-9 h-9 bg-accent text-white rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center shrink-0 shadow-lg shadow-blue-900/20 mb-0.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
        </div>
      </div>
    </div>
  );
};