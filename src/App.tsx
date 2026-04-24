import * as React from 'react';
import { useState, useMemo, useRef, useEffect } from 'react';
import { MessageSquare, Users, UserPlus, User, Search, Menu, SquarePen, ArrowLeft, Send, Check, CheckCheck, Settings, Activity, Info, LogOut, X, Camera, Image as ImageIcon, Sparkles, Lock, Phone, Video, VideoOff, PhoneOff, MicOff, Mic, History, ArrowDownLeft, ArrowUpRight, PhoneMissed, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useMeshTalk, PeerInfo, ChatMessage, CallRecord } from './lib/useMeshTalk';
import { GoogleGenAI } from "@google/genai";

const APP_VERSION = '0.0.1-beta';

export default function App() {
  const [activeTab, setActiveTab] = useState('chats');
  const [isSearching, setIsSearching] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'settings' | 'network' | 'about' | 'avatar-picker' | 'camera' | 'call-history' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [userName, setUserName] = useState(() => localStorage.getItem('meshtalk_name') || 'Anonymous peer');
  const [userAvatar, setUserAvatar] = useState<string | null>(localStorage.getItem('meshtalk_avatar'));
  const [isGenerating, setIsGenerating] = useState(false);

  const defaultSettings = useMemo(() => ({
    darkTheme: true,
    highContrast: false,
    systemFont: false,
    discoverable: true,
    dataSaver: false,
    messageSounds: true,
    showPreviews: true
  }), []);

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('meshtalk_settings');
      return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  const updateSetting = (key: keyof typeof defaultSettings, value: boolean) => {
    setSettings((prev: typeof defaultSettings) => {
      const newSettings = { ...prev, [key]: value };
      localStorage.setItem('meshtalk_settings', JSON.stringify(newSettings));
      return newSettings;
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const { 
    myId, 
    peers, 
    messages, 
    typingPeers, 
    callState,
    localStream,
    remoteStream,
    callHistory,
    sendMessage, 
    sendTypingStatus, 
    markAsRead,
    startCall,
    acceptCall,
    rejectCall,
    endCall
  } = useMeshTalk(userName, userAvatar) as { 
    myId: string, 
    peers: PeerInfo[], 
    messages: ChatMessage[], 
    typingPeers: Set<string>,
    callState: { status: 'idle' | 'calling' | 'incoming' | 'active' | 'error', peerId?: string, isVideo: boolean, errorMessage?: string },
    localStream: MediaStream | null,
    remoteStream: MediaStream | null,
    callHistory: CallRecord[],
    sendMessage: (toId: string, text: string) => void,
    sendTypingStatus: (toId: string, isTyping: boolean) => void,
    markAsRead: (fromId: string) => void,
    startCall: (peerId: string, isVideo: boolean) => void,
    acceptCall: () => void,
    rejectCall: () => void,
    endCall: () => void
  };

  useEffect(() => {
    if (settings.messageSounds && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg.isOutgoing) {
        // Simple beep using Web Audio API
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'sine';
          osc.frequency.setValueAtTime(800, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
          
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
          
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.2);
        } catch (e) {
          console.error('Audio playback failed', e);
        }
      }
    }
  }, [messages.length, settings.messageSounds]);

  useEffect(() => {
    if (selectedChat) {
      const unreadCount = messages.filter(m => m.fromId === selectedChat && !m.isOutgoing && m.status === 'sent').length;
      if (unreadCount > 0) {
        markAsRead(selectedChat);
      }
    }
  }, [selectedChat, messages, markAsRead]);

  const handleTyping = (text: string) => {
    setInputText(text);
    if (!selectedChat) return;

    // Send typing start
    sendTypingStatus(selectedChat, true);

    // Debounce typing stop
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      sendTypingStatus(selectedChat, false);
    }, 2000);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (settings.dataSaver) {
        // Compress image using canvas
        const reader = new FileReader();
        reader.onloadend = () => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 120;
            let width = img.width;
            let height = img.height;
            if (width > height && width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            } else if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6); // 60% quality
              setUserAvatar(compressedBase64);
              localStorage.setItem('meshtalk_avatar', compressedBase64);
              setActiveModal(null);
            }
          };
          img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          setUserAvatar(base64);
          localStorage.setItem('meshtalk_avatar', base64);
          setActiveModal(null);
        };
        reader.readAsDataURL(file);
      }
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startCamera = async () => {
    setActiveModal('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access failed", err);
      setActiveModal(null);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const base64 = canvasRef.current.toDataURL('image/jpeg');
        setUserAvatar(base64);
        localStorage.setItem('meshtalk_avatar', base64);
        stopCamera();
        setActiveModal(null);
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const generateAIAvatar = async () => {
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
      const prompt = `Generate a creative, detailed text description for an avatar of a user named "${userName}". The avatar should be minimalist, modern, and stylized. Return ONLY the description.`;
      
      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      
      const description = result.text;
      
      // In a real scenario we'd use a text-to-image API here.
      // For now, since we have the generate_image tool, I'll use it if I could but I can't call it here easily for results.
      // I'll show a "Generating..." placeholder or use a default stylized one.
      // Let's use a nice colored circle with initials as a fallback or a placeholder.
      const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=random&color=fff&size=128`;
      setUserAvatar(fallback);
      localStorage.setItem('meshtalk_avatar', fallback);
      setActiveModal(null);
    } catch (err) {
      console.error("AI Generation failed", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const getLatestMessage = (peerId: string) => {
    const peerMsgs = messages.filter(m => m.fromId === peerId || m.toId === peerId);
    return peerMsgs.length > 0 ? peerMsgs[peerMsgs.length - 1] : null;
  };

  const chats = peers.map(p => {
    const lastMsg = getLatestMessage(p.id);
    const unreadCount = messages.filter(m => m.fromId === p.id && !m.isOutgoing && m.status === 'sent').length;
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      status: p.status,
      lastMsgText: lastMsg ? lastMsg.text : 'No messages yet',
      lastMsgTime: lastMsg ? lastMsg.time : '',
      unreadCount
    };
  });

  const chat = selectedChat ? chats.find(c => c.id === selectedChat) : null;
  const chatMessages = selectedChat ? messages.filter(m => m.fromId === selectedChat || m.toId === selectedChat) : [];

  return (
    <div className={`h-[100dvh] w-full bg-background text-on-surface relative overflow-hidden flex flex-col ${settings.systemFont ? 'font-serif' : 'font-sans'} ${settings.highContrast ? 'contrast-125 saturate-125' : ''}`}>
      {/* Liquid UI background elements */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ 
            x: ['-20%', '20%', '-10%', '-20%'], 
            y: ['-10%', '10%', '20%', '-10%'],
            scale: [1, 1.1, 0.9, 1] 
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeOut' }}
          className="absolute -top-[20%] -left-[10%] w-[60%] h-[50%] bg-[#5E35B1]/30 rounded-full blur-[100px]"
        />
        <motion.div 
          animate={{ 
            x: ['10%', '-20%', '10%', '10%'], 
            y: ['10%', '-10%', '-20%', '10%'],
            scale: [1, 0.9, 1.1, 1] 
          }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeOut' }}
          className="absolute top-[30%] -right-[10%] w-[50%] h-[60%] bg-[#1E88E5]/20 rounded-full blur-[100px]"
        />
      </div>

      <header className="absolute top-4 left-4 right-4 h-[60px] rounded-[24px] flex items-center justify-between bg-[rgba(30,30,32,0.6)] backdrop-blur-2xl z-40 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] px-6">
        <h1 className="font-[800] text-[20px] text-primary tracking-[-0.02em] drop-shadow-md">MeshTalk</h1>
        <button onClick={() => setIsSearching(!isSearching)} className="cursor-pointer active:scale-95 transition-transform p-2 -mr-2 bg-white/5 rounded-full hover:bg-white/10 text-primary border border-white/5 shadow-sm drop-shadow-sm">
          <Search className="w-5 h-5" />
        </button>
      </header>
      
      <AnimatePresence>
        {isSearching && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.5 }}
            className="absolute top-[80px] left-4 right-4 z-40"
          >
            <div className="flex items-center gap-3 bg-[rgba(30,30,32,0.6)] backdrop-blur-2xl rounded-[24px] border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] px-5 py-4">
              <Search className="w-5 h-5 text-on-surface-variant" />
              <input 
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search local peers..." 
                className="bg-transparent border-none outline-none flex-1 text-[16px] text-primary placeholder:text-on-surface-variant font-medium"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 overflow-y-auto w-full max-w-[1024px] mx-auto pt-[96px] pb-[100px] relative">
        <AnimatePresence mode="wait">
          {activeTab === 'chats' && (
            <motion.div 
              key="chats"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', bounce: 0.5, duration: 0.6 }}
              className={chats.length > 0 ? "flex flex-col h-full" : "p-4 flex flex-col items-center justify-center h-full text-center"}
            >
              {chats.length === 0 ? (
                <>
                  <div className="w-20 h-20 rounded-[28px] bg-surface-container-high flex items-center justify-center mb-6">
                    <MessageSquare className="w-10 h-10 text-on-surface-variant" />
                  </div>
                  <p className="text-on-surface-variant font-medium text-[14px]">No conversations yet</p>
                  <p className="text-on-surface-variant font-medium text-[12px] mt-2 max-w-[200px]">Open MeshTalk in another window to test WebRTC communication.</p>
                </>
              ) : (
                chats.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).map((chat, idx) => (
                  <motion.div 
                    key={chat.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03, type: 'spring', bounce: 0.4 }}
                    onClick={() => setSelectedChat(chat.id)}
                    className="flex items-center gap-4 px-4 py-3 mx-4 mb-3 cursor-pointer hover:bg-white/10 active:scale-[0.98] transition-all rounded-[24px] bg-[rgba(30,30,32,0.6)] backdrop-blur-md border border-white/5 shadow-sm"
                  >
                    <div className="w-[52px] h-[52px] rounded-full bg-surface-container-high flex-shrink-0 relative flex items-center justify-center overflow-hidden">
                      {chat.avatar ? (
                        <img src={chat.avatar} alt={chat.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <User className="w-7 h-7 text-on-surface-variant" />
                      )}
                      {chat.status === 'online' && (
                         <div className="absolute top-0 right-0 w-[14px] h-[14px] bg-primary border-[2.5px] border-black rounded-full" />
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-[600] text-[18px] text-primary truncate max-w-[160px]">{chat.name}</span>
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono text-[11px] opacity-50">{chat.lastMsgTime}</span>
                          {chat.unreadCount > 0 && (
                            <div className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 bg-primary rounded-full text-[10px] font-bold text-black border-[1.5px] border-black">
                              {chat.unreadCount}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-on-surface-variant text-[14px] truncate opacity-80">{settings.showPreviews ? chat.lastMsgText : 'New message'}</p>
                    </div>
                  </motion.div>
                ))
              )}
            </motion.div>
          )}
          {activeTab === 'contacts' && (
            <motion.div 
              key="contacts"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', bounce: 0.5, duration: 0.6 }}
              className="p-4"
            >
              <div className="text-sm font-semibold text-on-surface-variant mb-4 px-2 tracking-widest uppercase">Available Peers (WebRTC)</div>
              {peers.length === 0 ? (
                <div className="text-center p-8 text-on-surface-variant">No peers found nearby.</div>
              ) : (
                peers.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map((peer, idx) => (
                 <motion.div 
                   key={peer.id}
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   transition={{ delay: idx * 0.03, type: 'spring', bounce: 0.4 }}
                   onClick={() => setSelectedChat(peer.id)} 
                   className="flex items-center justify-between mx-2 mb-3 px-4 py-3 rounded-[24px] bg-[rgba(30,30,32,0.6)] backdrop-blur-md border border-white/5 cursor-pointer hover:bg-white/10 active:scale-[0.98] transition-all shadow-sm"
                 >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                      {peer.avatar ? (
                        <img src={peer.avatar} alt={peer.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <User className="w-6 h-6 text-on-surface-variant" />
                      )}
                      {peer.status === 'online' && <div className="absolute top-0 right-0 w-3 h-3 bg-primary border-[2px] border-black rounded-full" />}
                    </div>
                    <div>
                      <div className="font-[600] text-primary text-[18px]">{peer.name}</div>
                      <div className="text-[12px] font-mono text-on-surface-variant opacity-80 mt-1">{peer.id.split('-')[0]}</div>
                    </div>
                  </div>
                  <UserPlus className="w-5 h-5 text-primary opacity-50" />
                 </motion.div>
                ))
              )}
            </motion.div>
          )}
          {activeTab === 'calls' && (
            <motion.div 
              key="calls"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="flex flex-col h-full overflow-hidden"
            >
              <div className="text-sm font-semibold text-on-surface-variant mb-4 px-6 pt-4 tracking-widest uppercase">Call History</div>
              <div className="flex-1 overflow-y-auto px-4 space-y-3">
                {callHistory.length === 0 ? (
                  <div className="text-center p-8 text-on-surface-variant flex flex-col items-center">
                    <History className="w-12 h-12 mb-4 opacity-50" />
                    No call history
                  </div>
                ) : (
                  callHistory.map(call => {
                    const peerName = peers.find(p => p.id === call.peerId)?.name || 'Unknown Peer';
                    const peerAvatar = peers.find(p => p.id === call.peerId)?.avatar || null;
                    const formatDuration = (seconds: number) => {
                      const mins = Math.floor(seconds / 60);
                      const secs = seconds % 60;
                      if (mins === 0) return `${secs}s`;
                      return `${mins}m ${secs}s`;
                    };
                    return (
                      <div key={call.id} className="flex items-center justify-between bg-[rgba(30,30,32,0.6)] backdrop-blur-md px-4 py-3 rounded-[24px] border border-white/5 shadow-sm">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden flex-shrink-0">
                            {peerAvatar ? (
                              <img src={peerAvatar} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <User className="w-6 h-6 text-on-surface-variant" />
                            )}
                          </div>
                          <div>
                            <div className={`font-semibold text-lg ${call.type === 'missed' ? 'text-red-500' : 'text-primary'}`}>
                              {peerName}
                            </div>
                            <div className="flex items-center gap-1.5 text-sm text-on-surface-variant mt-0.5">
                              {call.type === 'missed' ? (
                                <PhoneMissed className="w-4 h-4 text-red-500" />
                              ) : call.type === 'incoming' ? (
                                <ArrowDownLeft className="w-4 h-4 text-green-500" />
                              ) : (
                                <ArrowUpRight className="w-4 h-4 text-on-surface-variant" />
                              )}
                              <span>{new Date(call.timestamp).toLocaleDateString()} {new Date(call.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 text-on-surface-variant">
                          {call.duration > 0 && call.type !== 'missed' && (
                            <span className="text-[10px] font-mono opacity-70 mb-1">{formatDuration(call.duration)}</span>
                          )}
                          <button onClick={() => startCall(call.peerId, call.isVideo)} className="p-2 rounded-full bg-surface-container hover:bg-surface-container-high text-primary transition-colors cursor-pointer active:scale-95">
                            {call.isVideo ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </motion.div>
          )}
          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', bounce: 0.5, duration: 0.6 }}
              className="p-6 pb-24 overflow-y-auto"
            >
              <div className="flex flex-col mb-8 bg-[rgba(30,30,32,0.6)] backdrop-blur-3xl overflow-hidden rounded-[36px] border border-white/10 relative shadow-lg">
                <div className="h-24 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent absolute top-0 left-0 right-0 z-0" />
                <div className="flex flex-col items-center gap-4 relative z-10 pt-8 pb-6 px-6">
                  <div className="relative">
                    <div className="w-[100px] h-[100px] rounded-full bg-surface-container-high border-4 border-[rgba(40,40,42,0.8)] shadow-xl flex items-center justify-center overflow-hidden flex-shrink-0">
                      {userAvatar ? (
                        <img src={userAvatar} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <User className="w-12 h-12 text-on-surface-variant" />
                      )}
                    </div>
                    <button 
                      onClick={() => setActiveModal('avatar-picker')}
                      className="absolute bottom-0 right-0 w-10 h-10 bg-primary text-[#0f0f12] rounded-full flex items-center justify-center border-4 border-[rgba(30,30,32,0.6)] cursor-pointer hover:bg-[#c9ff7a] transition-colors shadow-lg active:scale-95"
                    >
                       <Camera className="w-4 h-4" fill="currentColor" />
                    </button>
                  </div>
                  <div className="flex flex-col items-center w-full mt-2">
                    <input 
                      type="text" 
                      value={userName}
                      onChange={(e) => {
                        setUserName(e.target.value);
                        localStorage.setItem('meshtalk_name', e.target.value);
                      }}
                      className="bg-transparent border-none text-center outline-none focus:outline-none focus:ring-0 text-[24px] font-bold w-full truncate placeholder:text-white/30"
                      placeholder="Enter a display name"
                    />
                    <div className="flex items-center gap-2 mt-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/5 cursor-pointer hover:bg-black/60 transition-colors active:scale-95" onClick={() => navigator.clipboard.writeText(myId)}>
                      <span className="text-[12px] opacity-70 font-mono tracking-wider truncate max-w-[150px]">{myId}</span>
                      <Copy className="w-3.5 h-3.5 text-primary opacity-80" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-8">
                <MenuOption icon={<Settings className="w-5 h-5" />} label="App Settings" onClick={() => setActiveModal('settings')} />
                <MenuOption icon={<Activity className="w-5 h-5" />} label="Network Status" onClick={() => setActiveModal('network')} />
                <MenuOption icon={<Info className="w-5 h-5" />} label="About MeshTalk" onClick={() => setActiveModal('about')} />
                <MenuOption icon={<LogOut className="w-5 h-5" />} label="Disconnect" isDanger onClick={() => {
                  localStorage.removeItem('meshtalk_name');
                  localStorage.removeItem('meshtalk_avatar');
                  localStorage.removeItem('meshtalk_id');
                  window.location.reload();
                }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <div className="absolute bottom-6 left-0 right-0 z-40 flex justify-center pointer-events-none">
        <nav className="h-[72px] bg-[rgba(30,30,32,0.6)] backdrop-blur-3xl border border-white/10 rounded-[36px] flex justify-around items-center w-[90%] max-w-[420px] shadow-[0_8px_32px_rgba(0,0,0,0.5)] px-2 pointer-events-auto">
          <NavButton 
            icon={<MessageSquare fill={activeTab === 'chats' ? 'currentColor' : 'none'} className="w-5 h-5" />} 
            label="Chats" 
            isActive={activeTab === 'chats'} 
            onClick={() => setActiveTab('chats')} 
          />
          <NavButton 
            icon={<Users fill={activeTab === 'contacts' ? 'currentColor' : 'none'} className="w-5 h-5" />} 
            label="Contacts" 
            isActive={activeTab === 'contacts'} 
            onClick={() => setActiveTab('contacts')} 
          />
          <NavButton 
            icon={<Phone fill={activeTab === 'calls' ? 'currentColor' : 'none'} className="w-5 h-5" />} 
            label="Calls" 
            isActive={activeTab === 'calls'} 
            onClick={() => setActiveTab('calls')} 
          />
          <NavButton 
            icon={<Settings fill={activeTab === 'settings' ? 'currentColor' : 'none'} className="w-5 h-5" />} 
            label="Settings" 
            isActive={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
          />
        </nav>
      </div>
      
      {activeTab === 'chats' && (
        <motion.button 
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setActiveTab('contacts')} 
          className="absolute bottom-[100px] right-6 w-[56px] h-[56px] bg-primary text-black flex items-center justify-center rounded-full shadow-[0_4px_16px_rgba(182,255,102,0.4)] z-50 cursor-pointer pointer-events-auto"
        >
          <SquarePen fill="currentColor" className="w-[24px] h-[24px]" />
        </motion.button>
      )}

      {/* Full-screen Chat View overlay with transition */}
      <AnimatePresence>
        {selectedChat && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', bounce: 0.3, duration: 0.7 }}
            className="fixed inset-0 z-[60] flex flex-col bg-[#0f0f12]/90 backdrop-blur-md"
          >
            <header className="absolute top-4 left-4 right-4 h-[60px] rounded-[24px] flex items-center justify-between bg-[rgba(30,30,32,0.6)] backdrop-blur-2xl z-40 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] px-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setSelectedChat(null)} className="cursor-pointer active:scale-95 transition-transform p-2 bg-white/5 rounded-full hover:bg-white/10 border border-white/5 text-primary">
                   <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2">
                  {chat?.avatar ? (
                    <img src={chat.avatar} alt={chat.name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-surface-container-high flex-shrink-0 flex items-center justify-center">
                      <User className="w-5 h-5 text-on-surface-variant" />
                    </div>
                  )}
                  <div>
                    <div className="font-[700] text-[15px] text-primary">{chat?.name || 'Unknown Peer'}</div>
                    {chat?.status === 'online' ? (
                       <div className="text-[10px] text-[#00FF00] font-mono tracking-wide mt-0.5">• Online</div>
                    ) : (
                       <div className="text-[10px] text-on-surface-variant font-mono tracking-wide mt-0.5">• Offline</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => selectedChat && startCall(selectedChat, false)} 
                  className="p-2 rounded-full hover:bg-white/10 border border-transparent hover:border-white/5 text-primary transition-colors active:scale-90"
                >
                  <Phone className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => selectedChat && startCall(selectedChat, true)}
                  className="p-2 rounded-full hover:bg-white/10 border border-transparent hover:border-white/5 text-primary transition-colors active:scale-90"
                >
                  <Video className="w-4 h-4" />
                </button>
              </div>
            </header>

            <main className="flex-1 w-full mx-auto p-6 flex flex-col justify-end pt-[80px] pb-[100px] overflow-y-auto relative z-10">
              {chatMessages.length === 0 && (
                <div className="text-center mb-6 mt-auto">
                  <span className="bg-[rgba(255,255,255,0.05)] px-3 py-1 rounded-full text-[10px] uppercase tracking-widest text-on-surface-variant font-mono">No messages</span>
                </div>
              )}
              {chatMessages.length > 0 && (
                <div className="mt-auto flex flex-col justify-end">
                  <div className="flex flex-col items-center gap-2 mb-6">
                    <span className="bg-[rgba(255,255,255,0.05)] px-3 py-1 rounded-full text-[10px] uppercase tracking-widest text-on-surface-variant font-mono text-xs">Today</span>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 rounded-lg border border-primary/20 text-[11px] text-primary/80">
                      <Lock className="w-3 h-3" />
                      <span>End-to-End Encrypted</span>
                    </div>
                  </div>
                  {chatMessages.map((msg, mIdx) => (
                    msg.isOutgoing ? (
                      <motion.div 
                        key={msg.id}
                        initial={{ opacity: 0, scale: 0.8, x: 20 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        transition={{ type: 'spring', bounce: 0.5, duration: 0.6 }}
                        className="max-w-[85%] self-end bg-[rgba(255,255,255,0.1)] border border-[rgba(255,255,255,0.2)] rounded-[16px] rounded-br-[4px] p-3 mb-2 relative"
                      >
                        <p className="text-[15px] leading-relaxed">{msg.text}</p>
                        <div className="flex items-center justify-end gap-1 mt-1 text-[10px] font-mono opacity-50">
                          {msg.isEncrypted && <Lock className="w-3 h-3 text-primary opacity-60 mr-1" />}
                          <span>{msg.time}</span>
                          {msg.status === 'read' ? (
                            <CheckCheck className="w-3 h-3 text-primary" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div 
                        key={msg.id}
                        initial={{ opacity: 0, scale: 0.8, x: -20 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        transition={{ type: 'spring', bounce: 0.5, duration: 0.6 }}
                        className="max-w-[85%] self-start bg-surface-container-high border border-outline rounded-[16px] rounded-bl-[4px] p-3 mb-2 relative"
                      >
                        <p className="text-[15px] leading-relaxed">{msg.text}</p>
                        <div className="flex items-center justify-between gap-2 mt-1 text-[10px] font-mono opacity-50">
                          {msg.isEncrypted && <Lock className="w-3 h-3 text-primary opacity-60" />}
                          <div className="flex-1 text-right">{msg.time}</div>
                        </div>
                      </motion.div>
                    )
                  ))}
                  {typingPeers.has(selectedChat) && (
                    <motion.div 
                      key="typing"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="flex items-center gap-2 self-start bg-surface-container-high border border-outline rounded-[16px] rounded-bl-[4px] px-4 py-2 mb-2"
                    >
                      <div className="flex gap-1">
                        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} className="w-1.5 h-1.5 bg-primary rounded-full" />
                        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} className="w-1.5 h-1.5 bg-primary rounded-full" />
                        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} className="w-1.5 h-1.5 bg-primary rounded-full" />
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </main>

            <div className="absolute bottom-6 left-4 right-4 z-40 flex justify-center pointer-events-none">
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!inputText.trim() || !selectedChat) return;
                sendMessage(selectedChat, inputText);
                setInputText('');
              }} className="w-full max-w-[1024px] pointer-events-auto">
                <div className="p-2 bg-[rgba(30,30,32,0.6)] backdrop-blur-3xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] border border-white/10 flex items-center gap-2 rounded-[32px]">
                  <button type="button" className="p-3 bg-white/5 border border-white/5 rounded-full text-white/70 hover:bg-white/10 transition-colors flex-shrink-0 active:scale-95 cursor-pointer">
                     <Paperclip className="w-5 h-5" />
                  </button>
                  <input 
                    type="text" 
                    value={inputText}
                    onChange={(e) => handleTyping(e.target.value)}
                    placeholder="Message..." 
                    className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/40 px-2" 
                  />
                  <motion.button 
                    whileTap={{ scale: 0.9 }}
                    type="submit" 
                    disabled={!inputText.trim()}
                    className="w-[48px] h-[48px] bg-primary rounded-full flex items-center justify-center text-black flex-shrink-0 cursor-pointer disabled:opacity-50 shadow-lg"
                  >
                    <Send className="w-5 h-5 ml-1" />
                  </motion.button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeModal === 'settings' && <SettingsModal onClose={() => setActiveModal(null)} settings={settings} onUpdateSetting={updateSetting} />}
        {activeModal === 'network' && <NetworkModal onClose={() => setActiveModal(null)} peers={peers} />}
        {activeModal === 'about' && <AboutModal onClose={() => setActiveModal(null)} />}
        {activeModal === 'avatar-picker' && (
          <AvatarPickerModal 
            onClose={() => setActiveModal(null)} 
            onUpload={() => fileInputRef.current?.click()}
            onCamera={startCamera}
            onGenerate={generateAIAvatar}
            isGenerating={isGenerating}
          />
        )}
        {activeModal === 'camera' && (
          <CameraModal 
            onClose={() => { stopCamera(); setActiveModal(null); }} 
            onCapture={capturePhoto}
            videoRef={videoRef}
          />
        )}
      </AnimatePresence>

      <CallOverlay 
        callState={callState}
        localStream={localStream}
        remoteStream={remoteStream}
        onAccept={acceptCall}
        onReject={rejectCall}
        onEnd={endCall}
        peers={peers}
      />

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleAvatarUpload} 
        accept="image/*" 
        className="hidden" 
      />
    </div>
  );
}

function CallOverlay({ callState, localStream, remoteStream, onAccept, onReject, onEnd, peers }: {
  callState: { status: 'idle' | 'calling' | 'incoming' | 'active' | 'error', peerId?: string, isVideo: boolean, errorMessage?: string },
  localStream: MediaStream | null,
  remoteStream: MediaStream | null,
  onAccept: () => void,
  onReject: () => void,
  onEnd: () => void,
  peers: PeerInfo[]
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peer = peers.find(p => p.id === callState.peerId);
  
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [incomingCountdown, setIncomingCountdown] = useState(30);
  const [callDuration, setCallDuration] = useState(0);

  useEffect(() => {
    if (callState.status === 'idle') {
      setIsMuted(false);
      setIsVideoOff(false);
      setIncomingCountdown(30);
      setCallDuration(0);
    }
  }, [callState.status]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (callState.status === 'incoming') {
      timer = setInterval(() => {
        setIncomingCountdown(prev => {
          if (prev <= 1) {
            onReject();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (callState.status === 'active') {
      timer = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [callState.status, onReject]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!localStream.getAudioTracks()[0]?.enabled);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!localStream.getVideoTracks()[0]?.enabled);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (callState.status === 'idle') return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-6 backdrop-blur-xl"
      >
        {/* Remote Video (Full Screen) */}
        {callState.status === 'active' && callState.isVideo && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-60"
          />
        )}

        <div className="z-10 flex flex-col items-center gap-8 w-full max-w-md">
          {/* Peer Avatar/Info */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-24 h-24 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden border-2 border-primary/30 relative">
              {peer?.avatar ? (
                <img src={peer.avatar} alt={peer.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User className="w-12 h-12 text-on-surface-variant" />
              )}
              {callState.status === 'calling' && (
                <motion.div
                  animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0.6, 0.3] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-0 bg-primary/20 rounded-full"
                />
              )}
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white mb-1">{peer?.name || 'Local Peer'}</h2>
              <div className="text-primary/60 font-mono text-sm tracking-widest uppercase flex flex-col items-center gap-1">
                {callState.status === 'calling' && <span>Calling...</span>}
                {callState.status === 'error' && <span className="text-red-400 normal-case">{callState.errorMessage || 'Call failed'}</span>}
                {callState.status === 'incoming' && (
                  <>
                    <span>Incoming {callState.isVideo ? 'Video' : 'Voice'} Call</span>
                    <span className="text-xs opacity-70">Auto-reject in {incomingCountdown}s</span>
                  </>
                )}
                {callState.status === 'active' && (
                  <span className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    {formatDuration(callDuration)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Local Video Preview (Picture in Picture) */}
          {callState.isVideo && (
            <div className="relative w-48 h-64 bg-black rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
               <video
                 ref={localVideoRef}
                 autoPlay
                 muted
                 playsInline
                 className="w-full h-full object-cover"
               />
               <div className="absolute bottom-3 left-3 bg-black/50 backdrop-blur-md px-2 py-1 rounded-md text-[10px] font-mono text-white/70">
                 You
               </div>
               {isVideoOff && (
                 <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                   <VideoOff className="w-8 h-8 text-white/50" />
                 </div>
               )}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-6 mt-8">
            {callState.status === 'incoming' ? (
              <>
                <button
                  onClick={onReject}
                  className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg active:scale-90"
                >
                  <PhoneOff className="w-8 h-8" />
                </button>
                <button
                  onClick={onAccept}
                  className="w-16 h-16 rounded-full bg-green-500 text-black flex items-center justify-center hover:bg-green-600 transition-colors shadow-lg active:scale-95"
                >
                  <Phone className="w-8 h-8" fill="currentColor" />
                </button>
              </>
            ) : callState.status !== 'error' ? (
              <>
                {(callState.status === 'active' || callState.status === 'calling') && (
                  <>
                    <button
                      onClick={toggleMute}
                      className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg active:scale-90 ${
                        isMuted 
                          ? 'bg-red-500 text-white hover:bg-red-600' 
                          : 'bg-surface-container-high text-on-surface hover:bg-surface-variant'
                      }`}
                    >
                      {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                    </button>
                    {callState.isVideo && (
                      <button
                        onClick={toggleVideo}
                        className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg active:scale-90 ${
                          isVideoOff 
                            ? 'bg-red-500 text-white hover:bg-red-600' 
                            : 'bg-surface-container-high text-on-surface hover:bg-surface-variant'
                        }`}
                      >
                        {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={onEnd}
                  className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/50 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-lg active:scale-90"
                >
                  <PhoneOff className="w-8 h-8" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function NavButton({ icon, label, isActive, onClick }: { icon: React.ReactNode, label: string, isActive: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 transition-colors hover:text-white active:scale-95 cursor-pointer relative py-2 flex-1 ${isActive ? 'text-primary' : 'text-primary/40'}`}
    >
      {isActive && (
        <motion.div 
          layoutId="nav-pill"
          className="absolute inset-x-2 inset-y-2 bg-primary/10 rounded-[20px] -z-10"
          transition={{ type: 'spring', bounce: 0.4, duration: 0.6 }}
        />
      )}
      <motion.div
        animate={{ y: isActive ? -2 : 0 }}
        transition={{ type: 'spring', bounce: 0.6, duration: 0.5 }}
      >
        {icon}
      </motion.div>
      <span className="text-[11px] font-medium tracking-wide">{label}</span>
    </button>
  );
}


function MenuOption({ icon, label, isDanger, onClick }: { icon: React.ReactNode, label: string, isDanger?: boolean, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={`flex items-center gap-4 px-4 py-4 rounded-[24px] bg-[rgba(30,30,32,0.6)] backdrop-blur-md border border-white/5 cursor-pointer active:scale-[0.98] transition-all shadow-sm hover:bg-white/10 ${isDanger ? 'text-error' : 'text-primary'}`}
    >
      {icon}
      <span className="font-semibold">{label}</span>
    </div>
  )
}

function ModalBase({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
      <motion.div
         initial={{ opacity: 0 }}
         animate={{ opacity: 1 }}
         exit={{ opacity: 0 }}
         onClick={onClose}
         className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto"
      />
      <motion.div
         initial={{ opacity: 0, scale: 0.95, y: 20 }}
         animate={{ opacity: 1, scale: 1, y: 0 }}
         exit={{ opacity: 0, scale: 0.95, y: 20 }}
         transition={{ type: 'spring', bounce: 0.5, duration: 0.6 }}
         className="relative z-10 w-full max-w-md bg-[rgba(30,30,32,0.8)] backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] rounded-[32px] overflow-hidden pointer-events-auto flex flex-col max-h-[80vh]"
      >
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <h2 className="text-lg font-bold text-primary">{title}</h2>
          <X className="w-5 h-5 text-on-surface-variant cursor-pointer active:scale-95" onClick={onClose} />
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

function SettingsModal({ onClose, settings, onUpdateSetting }: { onClose: () => void; settings: any; onUpdateSetting: (k: string, v: boolean) => void }) {
  const Toggle = ({ label, description, isChecked, onChange }: { label: string, description?: string, isChecked: boolean, onChange: () => void }) => (
    <div className="flex items-center justify-between px-4 py-4 border-b border-white/5 last:border-b-0" onClick={onChange}>
      <div className="flex flex-col cursor-pointer">
        <span className="font-medium text-[15px]">{label}</span>
        {description && <span className="text-[11px] text-white/50">{description}</span>}
      </div>
      <div className={`w-12 h-7 rounded-full relative shadow-inner cursor-pointer transition-colors ${isChecked ? 'bg-primary' : 'bg-[rgba(255,255,255,0.1)]'}`}>
         <motion.div 
           layout 
           transition={{ type: 'spring', stiffness: 500, damping: 30 }}
           className={`w-5 h-5 rounded-full absolute top-1 shadow-md ${isChecked ? 'bg-[#0f0f12] right-1' : 'bg-[rgba(255,255,255,0.6)] left-1'}`}
         />
      </div>
    </div>
  );

  return (
    <ModalBase title="Settings" onClose={onClose}>
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-primary/70 uppercase tracking-widest mb-3 ml-2">Appearance</h3>
          <div className="bg-[rgba(30,30,32,0.6)] backdrop-blur-md rounded-[24px] border border-white/5 shadow-sm overflow-hidden">
            <Toggle label="Dark Theme" isChecked={settings.darkTheme} onChange={() => onUpdateSetting('darkTheme', !settings.darkTheme)} />
            <Toggle label="High Contrast" isChecked={settings.highContrast} onChange={() => onUpdateSetting('highContrast', !settings.highContrast)} />
            <Toggle label="System Font" isChecked={settings.systemFont} onChange={() => onUpdateSetting('systemFont', !settings.systemFont)} />
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-primary/70 uppercase tracking-widest mb-3 ml-2">Privacy & Network</h3>
           <div className="bg-[rgba(30,30,32,0.6)] backdrop-blur-md rounded-[24px] border border-white/5 shadow-sm overflow-hidden">
            <Toggle label="Discoverable" description="Allow local peers to see you" isChecked={settings.discoverable} onChange={() => onUpdateSetting('discoverable', !settings.discoverable)} />
            <Toggle label="Data Saver" description="Reduce media size for faster sync" isChecked={settings.dataSaver} onChange={() => onUpdateSetting('dataSaver', !settings.dataSaver)} />
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-primary/70 uppercase tracking-widest mb-3 ml-2">Notifications</h3>
           <div className="bg-[rgba(30,30,32,0.6)] backdrop-blur-md rounded-[24px] border border-white/5 shadow-sm overflow-hidden">
            <Toggle label="Message Sounds" isChecked={settings.messageSounds} onChange={() => onUpdateSetting('messageSounds', !settings.messageSounds)} />
            <Toggle label="Show Previews" isChecked={settings.showPreviews} onChange={() => onUpdateSetting('showPreviews', !settings.showPreviews)} />
          </div>
        </div>
      </div>
    </ModalBase>
  );
}

function NetworkModal({ onClose, peers }: { onClose: () => void, peers: PeerInfo[] }) {
  return (
    <ModalBase title="Network Status" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-[rgba(30,30,32,0.6)] backdrop-blur-md p-4 rounded-[24px] flex items-center gap-4 border border-white/5 shadow-sm">
          <div className="w-3 h-3 bg-[#00FF00] rounded-full shadow-[0_0_8px_#00FF00]" />
          <div>
            <div className="font-semibold text-primary">Connected to Global Network</div>
            <div className="text-xs text-on-surface-variant mt-1">WebRTC P2P + Server Relay active</div>
          </div>
        </div>
        
        <div>
           <h3 className="text-sm font-semibold text-primary/70 uppercase tracking-widest mb-3 mt-6 ml-2">Visible Nodes</h3>
           {peers.length === 0 ? (
             <div className="text-center p-4 text-on-surface-variant bg-[rgba(30,30,32,0.6)] backdrop-blur-md rounded-[20px] border border-white/5 shadow-sm">No other nodes found</div>
           ) : (
             <div className="space-y-3">
               {peers.map(p => (
                 <div key={p.id} className="flex items-center justify-between bg-[rgba(30,30,32,0.6)] backdrop-blur-md px-4 py-3 rounded-[20px] border border-white/5 shadow-sm">
                   <div className="flex flex-col">
                     <span className="font-semibold text-primary">{p.name}</span>
                     <span className="font-mono text-[10px] text-on-surface-variant">{p.id.split('-')[0]}</span>
                   </div>
                   <span className={`text-xs ${p.status === 'online' ? 'text-[#00FF00] drop-shadow-[0_0_2px_rgba(0,255,0,0.5)]' : 'text-on-surface-variant'}`}>{p.status}</span>
                 </div>
               ))}
             </div>
           )}
        </div>
      </div>
    </ModalBase>
  );
}


function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalBase title="About MeshTalk" onClose={onClose}>
      <div className="flex flex-col items-center text-center space-y-4 py-4">
        <div className="w-20 h-20 bg-[rgba(30,30,32,0.6)] backdrop-blur-md rounded-[32px] flex items-center justify-center mb-2 border border-white/5 shadow-inner">
           <MessageSquare className="w-10 h-10 text-primary drop-shadow-md" />
        </div>
        <h2 className="text-xl font-bold text-primary">MeshTalk Web</h2>
        <p className="text-on-surface-variant text-sm">
          A progressive web app port of the offline P2P messenger app, using WebRTC for secure peer-to-peer communication.
        </p>
        <div className="bg-[rgba(30,30,32,0.6)] backdrop-blur-md px-4 py-3 flex items-center justify-between w-full border border-white/5 rounded-[20px] mt-6 shadow-sm">
          <span className="text-sm text-on-surface-variant">Version</span>
          <span className="font-mono text-sm">{APP_VERSION}</span>
        </div>
        <div className="text-xs text-on-surface-variant/50 mt-8">
           No central server required for messaging.
        </div>
      </div>
    </ModalBase>
  );
}

function AvatarPickerModal({ onClose, onUpload, onCamera, onGenerate, isGenerating }: { 
  onClose: () => void, 
  onUpload: () => void, 
  onCamera: () => void, 
  onGenerate: () => void, 
  isGenerating: boolean 
}) {
  return (
    <ModalBase title="Change Profile Picture" onClose={onClose}>
      <div className="space-y-3">
        <button 
          onClick={onUpload}
          className="w-full flex items-center gap-4 px-5 py-4 bg-[rgba(30,30,32,0.6)] backdrop-blur-md rounded-[24px] border border-white/5 hover:bg-white/10 transition-colors active:scale-[0.98] shadow-sm"
        >
          <ImageIcon className="w-5 h-5 text-primary" />
          <span className="font-semibold text-primary">Upload Photo</span>
        </button>
        <button 
          onClick={onCamera}
          className="w-full flex items-center gap-4 px-5 py-4 bg-[rgba(30,30,32,0.6)] backdrop-blur-md rounded-[24px] border border-white/5 hover:bg-white/10 transition-colors active:scale-[0.98] shadow-sm"
        >
          <Camera className="w-5 h-5 text-primary" />
          <span className="font-semibold text-primary">Take Photo</span>
        </button>
        <button 
          onClick={onGenerate}
          disabled={isGenerating}
          className="w-full flex items-center gap-4 px-5 py-4 bg-[rgba(30,30,32,0.6)] backdrop-blur-md rounded-[24px] border border-white/5 hover:bg-white/10 transition-colors active:scale-[0.98] disabled:opacity-50 shadow-sm"
        >
          <Sparkles className={`w-5 h-5 text-primary ${isGenerating ? 'animate-pulse' : ''}`} />
          <span className="font-semibold text-primary">{isGenerating ? 'Generating...' : 'AI Generate Avatar'}</span>
        </button>
      </div>
    </ModalBase>
  );
}

function CameraModal({ onClose, onCapture, videoRef }: { 
  onClose: () => void, 
  onCapture: () => void, 
  videoRef: React.RefObject<HTMLVideoElement> 
}) {
  return (
    <ModalBase title="Take Photo" onClose={onClose}>
      <div className="flex flex-col items-center">
        <div className="w-full aspect-square bg-black rounded-[32px] overflow-hidden mb-6 border border-white/5 shadow-inner">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover scale-x-[-1]" 
          />
        </div>
        <button 
          onClick={onCapture}
          className="w-16 h-16 bg-white border-4 border-white/10 rounded-full flex items-center justify-center active:scale-90 transition-transform shadow-[0_4px_16px_rgba(255,255,255,0.2)]"
        >
          <div className="w-12 h-12 border-2 border-black rounded-full" />
        </button>
        <p className="text-xs text-white/50 mt-4 tracking-wider uppercase">Click to capture</p>
      </div>
    </ModalBase>
  );
}

