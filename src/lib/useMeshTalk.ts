import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { generateKeyPair, exportPublicKey, importPublicKey, encryptMessage, decryptMessage } from './encryption';

export interface PeerInfo {
  id: string;
  name: string;
  avatar: string | null;
  publicKey?: string | null;
  status: 'online' | 'offline';
}

export interface ChatMessage {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  time: string;
  isOutgoing: boolean;
  isEncrypted?: boolean;
  status: 'sent' | 'read';
}

export interface CallRecord {
  id: string;
  peerId: string;
  type: 'incoming' | 'outgoing' | 'missed';
  timestamp: number;
  duration: number;
  isVideo: boolean;
}

export function useMeshTalk(userName: string, userAvatar: string | null) {
  const [myId, setMyId] = useState<string>('');
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [keyPair, setKeyPair] = useState<CryptoKeyPair | null>(null);
  const [typingPeers, setTypingPeers] = useState<Set<string>>(new Set());
  const [callState, setCallState] = useState<{ status: 'idle' | 'calling' | 'incoming' | 'active' | 'error', peerId?: string, isVideo: boolean, errorMessage?: string }>({ status: 'idle', isVideo: false });
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callHistory, setCallHistory] = useState<CallRecord[]>([]);

  const peerPublicKeys = useRef<Map<string, CryptoKey>>(new Map());
  
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const typingTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const remoteStreamSetRef = useRef<Set<string>>(new Set());
  const pendingCallOffer = useRef<Map<string, any>>(new Map());
  const activeCallContext = useRef<{ id: string, peerId: string, isVideo: boolean, type: 'incoming' | 'outgoing', startTime: number, answeredTime?: number, answered: boolean } | null>(null);

  useEffect(() => {
    let storedId = localStorage.getItem('meshtalk_id');
    if (!storedId) {
      storedId = uuidv4();
      localStorage.setItem('meshtalk_id', storedId);
    }
    setMyId(storedId);

    const storedHistory = localStorage.getItem('meshtalk_call_history');
    if (storedHistory) {
      try {
        setCallHistory(JSON.parse(storedHistory));
      } catch (e) {}
    }

    generateKeyPair().then(kp => {
      setKeyPair(kp);
    });
  }, []);

  const addCallRecord = (record: CallRecord) => {
    setCallHistory(prev => {
      const next = [record, ...prev];
      localStorage.setItem('meshtalk_call_history', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    if (!myId || !userName || !keyPair) return;

    const socket = io();
    socketRef.current = socket;

    const setupSocket = async () => {
      const pubKeyBase64 = await exportPublicKey(keyPair.publicKey);
      socket.emit('announce', { id: myId, name: userName, avatar: userAvatar, publicKey: pubKeyBase64 });
    };

    socket.on('connect', setupSocket);

    socket.on('peer_list', (list: any[]) => {
      setPeers((prev: Map<string, PeerInfo>) => {
        const next = new Map<string, PeerInfo>(prev);
        list.forEach(async p => {
          if (p.id !== myId) {
            next.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, publicKey: p.publicKey, status: 'online' });
            if (p.publicKey) {
              const imported = await importPublicKey(p.publicKey);
              peerPublicKeys.current.set(p.id, imported);
            }
          }
        });
        return next;
      });
    });

    socket.on('peer_joined', async (p: any) => {
      if (p.id !== myId) {
        setPeers((prev: Map<string, PeerInfo>) => {
          const next = new Map<string, PeerInfo>(prev);
          next.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, publicKey: p.publicKey, status: 'online' });
          return next;
        });
        if (p.publicKey) {
          const imported = await importPublicKey(p.publicKey);
          peerPublicKeys.current.set(p.id, imported);
        }
        initiateWebRTC(p.id);
      }
    });

    socket.on('peer_left', ({ id }: { id: string }) => {
      setPeers((prev: Map<string, PeerInfo>) => {
        const next = new Map<string, PeerInfo>(prev);
        const peer = next.get(id);
        if (peer) {
          const updatedPeer: PeerInfo = {
            id: peer.id,
            name: peer.name,
            avatar: peer.avatar,
            publicKey: peer.publicKey,
            status: 'offline'
          };
          next.set(id, updatedPeer);
        }
        return next;
      });
      const pc = peerConnectionsRef.current.get(id);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(id);
        dataChannelsRef.current.delete(id);
      }
    });

    socket.on('signal', async ({ from, signal }: { from: string, signal: any }) => {
      let pc = peerConnectionsRef.current.get(from);
      if (!pc) pc = createPeerConnection(from);

      if (signal.type === 'offer') {
        if (signal.isCall) {
          activeCallContext.current = {
            id: Date.now().toString(),
            peerId: from,
            isVideo: signal.isVideo,
            type: 'incoming',
            startTime: Date.now(),
            answered: false
          };
          setCallState({ status: 'incoming', peerId: from, isVideo: signal.isVideo });
          pendingCallOffer.current.set(from, signal);
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { to: from, from: myId, signal: { ...pc.localDescription?.toJSON(), isCall: signal.isCall } });
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        setCallState(prev => {
          if (prev.status === 'calling') {
            if (activeCallContext.current) {
              activeCallContext.current.answered = true;
              activeCallContext.current.answeredTime = Date.now();
            }
            return { ...prev, status: 'active' };
          }
          return prev;
        });
      } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else if (signal.type === 'hangup') {
        endCallInternal();
      }
    });

    socket.on('relay_message', async ({ from, msgData }: { from: string, msgData: any }) => {
      if (msgData.type === 'read_receipt') {
        const { messageId } = msgData;
        setMessages(prev => prev.map(m => 
          (m.id === messageId || (messageId === 'all' && m.toId === from)) ? { ...m, status: 'read' } : m
        ));
        return;
      }

      if (msgData.type === 'typing') {
        const isTyping = msgData.isTyping;
        setTypingPeers(prev => {
          const next = new Set(prev);
          if (isTyping) next.add(from);
          else next.delete(from);
          return next;
        });
        if (isTyping) {
          if (typingTimeoutRef.current.has(from)) clearTimeout(typingTimeoutRef.current.get(from));
          const timeout = setTimeout(() => {
            setTypingPeers(prev => {
              const next = new Set(prev);
              next.delete(from);
              return next;
            });
          }, 3000);
          typingTimeoutRef.current.set(from, timeout);
        }
        return;
      }

      let text = msgData.text;
      let isEncrypted = false;
      if (msgData.isEncrypted && keyPair) {
        try {
          text = await decryptMessage(msgData.text, keyPair.privateKey);
          isEncrypted = true;
        } catch (e) {
          console.error("Failed to decrypt relayed message", e);
          text = "[Encrypted Message - Decryption Failed]";
        }
      }

      setMessages(prev => [...prev, {
        id: msgData.id,
        fromId: from,
        toId: myId,
        text: text,
        time: msgData.time,
        isOutgoing: false,
        isEncrypted
      }]);
    });

    return () => {
      socket.disconnect();
    };
  }, [myId, userName, keyPair]);

  function createPeerConnection(peerId: string) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('signal', {
          to: peerId,
          from: myId,
          signal: { candidate: event.candidate }
        });
      }
    };

    pc.ondatachannel = (event) => {
      const receiveChannel = event.channel;
      setupDataChannel(peerId, receiveChannel);
    };

    pc.ontrack = (event) => {
      console.log('Received track:', event.streams[0]);
      setRemoteStream(event.streams[0]);
    };

    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  }

  function setupDataChannel(peerId: string, channel: RTCDataChannel) {
    channel.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'read_receipt') {
        const { messageId } = data;
        setMessages(prev => prev.map(m => 
          (m.id === messageId || (messageId === 'all' && m.toId === peerId)) ? { ...m, status: 'read' } : m
        ));
        return;
      }

      if (data.type === 'typing') {
        const isTyping = data.isTyping;
        setTypingPeers(prev => {
          const next = new Set(prev);
          if (isTyping) next.add(peerId);
          else next.delete(peerId);
          return next;
        });
        
        if (isTyping) {
          if (typingTimeoutRef.current.has(peerId)) clearTimeout(typingTimeoutRef.current.get(peerId));
          const timeout = setTimeout(() => {
            setTypingPeers(prev => {
              const next = new Set(prev);
              next.delete(peerId);
              return next;
            });
          }, 3000);
          typingTimeoutRef.current.set(peerId, timeout);
        }
        return;
      }

      if (data.type === 'chat') {
        let text = data.text;
        let isEncrypted = false;
        if (data.isEncrypted && keyPair) {
          try {
            text = await decryptMessage(data.text, keyPair.privateKey);
            isEncrypted = true;
          } catch (e) {
            console.error("Failed to decrypt P2P message", e);
            text = "[Encrypted Message - Decryption Failed]";
          }
        }

        setMessages(prev => [...prev, {
          id: data.id,
          fromId: peerId,
          toId: myId,
          text: text,
          time: data.time,
          isOutgoing: false,
          isEncrypted
        }]);
      }
    };

    channel.onopen = () => {
      console.log(`Data Channel open with ${peerId}`);
    };

    dataChannelsRef.current.set(peerId, channel);
  }

  function initiateWebRTC(peerId: string) {
    if (peerConnectionsRef.current.has(peerId)) return;
    const pc = createPeerConnection(peerId);
    const sendChannel = pc.createDataChannel('sendChannel');
    setupDataChannel(peerId, sendChannel);

    pc.createOffer().then(offer => {
      return pc.setLocalDescription(offer);
    }).then(() => {
      if (socketRef.current) {
        socketRef.current.emit('signal', { to: peerId, from: myId, signal: pc.localDescription });
      }
    }).catch(console.error);
  }

  function sendTypingStatus(toPeerId: string, isTyping: boolean) {
    const channel = dataChannelsRef.current.get(toPeerId);
    const msgData = { type: 'typing', isTyping };

    if (!channel || channel.readyState !== 'open') {
      if (socketRef.current) {
        socketRef.current.emit('relay_message', { to: toPeerId, from: myId, msgData });
      }
    } else {
      channel.send(JSON.stringify(msgData));
    }
  }

  function markAsRead(toPeerId: string, messageId: string = 'all') {
    const channel = dataChannelsRef.current.get(toPeerId);
    const msgData = { type: 'read_receipt', messageId };

    if (!channel || channel.readyState !== 'open') {
      if (socketRef.current) {
        socketRef.current.emit('relay_message', { to: toPeerId, from: myId, msgData });
      }
    } else {
      channel.send(JSON.stringify(msgData));
    }
    
    // Also update local state for messages from this peer
    setMessages(prev => prev.map(m => 
      (m.fromId === toPeerId && m.status === 'sent') ? { ...m, status: 'read' } : m
    ));
  }

  async function startCall(peerId: string, isVideo: boolean) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: isVideo 
      });
      setLocalStream(stream);
      
      activeCallContext.current = {
        id: Date.now().toString(),
        peerId,
        isVideo,
        type: 'outgoing',
        startTime: Date.now(),
        answered: false
      };
      
      setCallState({ status: 'calling', peerId, isVideo });

      let pc = peerConnectionsRef.current.get(peerId);
      if (!pc) pc = createPeerConnection(peerId);

      // Explicitly remove existing tracks if any (cleanup)
      pc.getSenders().forEach(sender => pc?.removeTrack(sender));
      
      stream.getTracks().forEach(track => pc?.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      if (socketRef.current) {
        socketRef.current.emit('signal', { 
          to: peerId, 
          from: myId, 
          signal: { ...pc.localDescription?.toJSON(), isCall: true, isVideo } 
        });
      }
    } catch (err: any) {
      console.error("Failed to start call:", err);
      let errMsg = err?.message || err?.name || 'Permission denied. Please allow camera and microphone access.';
      if (err?.name === 'NotAllowedError' || err?.message?.includes('Permission denied')) {
        errMsg = 'Device permission denied. Please allow camera/microphone access in your browser settings or click the Open App in New Tab button if in preview.';
      } else if (err?.name === 'NotFoundError') {
        errMsg = 'No camera or microphone found on your device.';
      }
      setCallState({ status: 'error', isVideo, errorMessage: errMsg });
      setTimeout(() => setCallState({ status: 'idle', isVideo: false }), 5000);
    }
  }

  async function acceptCall() {
    const peerId = callState.peerId;
    if (callState.status !== 'incoming' || !peerId) return;
    
    const offer = pendingCallOffer.current.get(peerId);
    if (!offer) {
      console.error("No pending offer found for peer", peerId);
      rejectCall();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: callState.isVideo 
      });
      setLocalStream(stream);
      
      if (activeCallContext.current) {
        activeCallContext.current.answered = true;
        activeCallContext.current.answeredTime = Date.now();
      }
      
      setCallState(prev => ({ ...prev, status: 'active' }));

      let pc = peerConnectionsRef.current.get(peerId);
      if (!pc) pc = createPeerConnection(peerId);

      // Set remote description FIRST before creating answer
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      pendingCallOffer.current.delete(peerId);

      stream.getTracks().forEach(track => pc?.addTrack(track, stream));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      if (socketRef.current) {
        socketRef.current.emit('signal', { 
          to: peerId, 
          from: myId, 
          signal: { ...pc.localDescription?.toJSON(), isCall: true } 
        });
      }
    } catch (err: any) {
      console.error("Failed to accept call:", err);
      let errMsg = err?.message || err?.name || 'Permission denied. Please allow camera and microphone access.';
      if (err?.name === 'NotAllowedError' || err?.message?.includes('Permission denied')) {
        errMsg = 'Device permission denied. Please allow camera/microphone access in your browser settings or click the Open App in New Tab button if in preview.';
      } else if (err?.name === 'NotFoundError') {
        errMsg = 'No camera or microphone found on your device.';
      }
      setCallState({ status: 'error', isVideo: callState.isVideo, errorMessage: errMsg });
      setTimeout(() => rejectCall(), 4000);
    }
  }

  function rejectCall() {
    if (callState.peerId) {
      if (socketRef.current) {
        socketRef.current.emit('signal', { 
          to: callState.peerId, 
          from: myId, 
          signal: { type: 'hangup' } 
        });
      }
      pendingCallOffer.current.delete(callState.peerId);
    }
    endCallInternal();
  }

  function endCall() {
    if (callState.peerId && socketRef.current) {
      socketRef.current.emit('signal', { 
        to: callState.peerId, 
        from: myId, 
        signal: { type: 'hangup' } 
      });
    }
    endCallInternal();
  }

  function endCallInternal() {
    setCallState({ status: 'idle', isVideo: false });
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    setRemoteStream(null);
    
    if (activeCallContext.current) {
      const ctx = activeCallContext.current;
      let duration = 0;
      if (ctx.answered && ctx.answeredTime) {
        duration = Math.floor((Date.now() - ctx.answeredTime) / 1000);
      }
      let finalType: 'incoming' | 'outgoing' | 'missed' = ctx.type;
      if (ctx.type === 'incoming' && !ctx.answered) {
        finalType = 'missed';
      }
      
      addCallRecord({
        id: ctx.id,
        peerId: ctx.peerId,
        type: finalType,
        timestamp: ctx.startTime,
        duration,
        isVideo: ctx.isVideo
      });
      activeCallContext.current = null;
    }
  }

  async function sendMessage(toPeerId: string, text: string) {
    sendTypingStatus(toPeerId, false);
    const channel = dataChannelsRef.current.get(toPeerId);
    const peerPubKey = peerPublicKeys.current.get(toPeerId);

    let encryptedText = text;
    let isEncrypted = false;
    if (peerPubKey) {
      try {
        encryptedText = await encryptMessage(text, peerPubKey);
        isEncrypted = true;
      } catch (e) {
        console.error("Encryption failed", e);
      }
    }
    
    const msgData = {
      type: 'chat',
      id: uuidv4(),
      text: encryptedText,
      isEncrypted,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    if (!channel || channel.readyState !== 'open') {
      initiateWebRTC(toPeerId);
      if (socketRef.current) {
        socketRef.current.emit('relay_message', { to: toPeerId, from: myId, msgData });
      }
    } else {
      channel.send(JSON.stringify(msgData));
    }

    setMessages(prev => [...prev, {
      id: msgData.id,
      fromId: myId,
      toId: toPeerId,
      text: text,
      time: msgData.time,
      isOutgoing: true,
      isEncrypted,
      status: 'sent'
    }]);
  }

  return {
    myId,
    peers: Array.from(peers.values()),
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
  };
}
