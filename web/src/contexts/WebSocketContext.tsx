import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface SearchUpdate {
  searchId: string;
  status: 'active' | 'completed' | 'cancelled';
  activeCalls: number;
  connectedCalls: number;
  failedCalls: number;
}

interface PharmacistReady {
  searchId: string;
  callId: string;
  pharmacyId: string;
  pharmacyName: string;
  type: 'human' | 'voicemail';
}

interface CallStateChange {
  callId: string;
  searchId: string;
  newState: string;
  pharmacyName: string;
}

interface WebSocketContextType {
  isConnected: boolean;
  onSearchUpdate: (callback: (data: SearchUpdate) => void) => () => void;
  onPharmacistReady: (callback: (data: PharmacistReady) => void) => () => void;
  onCallStateChange: (callback: (data: CallStateChange) => void) => () => void;
  joinSearch: (searchId: string) => void;
  leaveSearch: (searchId: string) => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    const token = localStorage.getItem('token');
    const newSocket = io({
      auth: { token },
      transports: ['polling', 'websocket'],
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('[WebSocket] Connected:', newSocket.id);
      setIsConnected(true);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[WebSocket] Disconnected:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('[WebSocket] Connection error:', error.message);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [isAuthenticated]);

  const onSearchUpdate = useCallback(
    (callback: (data: SearchUpdate) => void) => {
      if (!socket) return () => {};
      socket.on('search_update', callback);
      return () => {
        socket.off('search_update', callback);
      };
    },
    [socket]
  );

  const onPharmacistReady = useCallback(
    (callback: (data: PharmacistReady) => void) => {
      if (!socket) return () => {};
      // Listen for both pharmacist_ready and voicemail_ready
      const handlePharmacistReady = (data: PharmacistReady) => callback({ ...data, type: 'human' });
      const handleVoicemailReady = (data: PharmacistReady) => callback({ ...data, type: 'voicemail' });
      socket.on('pharmacist_ready', handlePharmacistReady);
      socket.on('voicemail_ready', handleVoicemailReady);
      return () => {
        socket.off('pharmacist_ready', handlePharmacistReady);
        socket.off('voicemail_ready', handleVoicemailReady);
      };
    },
    [socket]
  );

  const onCallStateChange = useCallback(
    (callback: (data: CallStateChange) => void) => {
      if (!socket) return () => {};
      socket.on('call_status_update', callback);
      return () => {
        socket.off('call_status_update', callback);
      };
    },
    [socket]
  );

  const joinSearch = useCallback(
    (searchId: string) => {
      if (socket) {
        socket.emit('subscribe:search', searchId);
      }
    },
    [socket]
  );

  const leaveSearch = useCallback(
    (searchId: string) => {
      if (socket) {
        socket.emit('unsubscribe:search', searchId);
      }
    },
    [socket]
  );

  return (
    <WebSocketContext.Provider
      value={{
        isConnected,
        onSearchUpdate,
        onPharmacistReady,
        onCallStateChange,
        joinSearch,
        leaveSearch,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}
