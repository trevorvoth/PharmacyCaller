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
      transports: ['websocket'],
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [isAuthenticated]);

  const onSearchUpdate = useCallback(
    (callback: (data: SearchUpdate) => void) => {
      if (!socket) return () => {};
      socket.on('search:update', callback);
      return () => {
        socket.off('search:update', callback);
      };
    },
    [socket]
  );

  const onPharmacistReady = useCallback(
    (callback: (data: PharmacistReady) => void) => {
      if (!socket) return () => {};
      socket.on('pharmacist:ready', callback);
      return () => {
        socket.off('pharmacist:ready', callback);
      };
    },
    [socket]
  );

  const onCallStateChange = useCallback(
    (callback: (data: CallStateChange) => void) => {
      if (!socket) return () => {};
      socket.on('call:state', callback);
      return () => {
        socket.off('call:state', callback);
      };
    },
    [socket]
  );

  const joinSearch = useCallback(
    (searchId: string) => {
      if (socket) {
        socket.emit('search:join', { searchId });
      }
    },
    [socket]
  );

  const leaveSearch = useCallback(
    (searchId: string) => {
      if (socket) {
        socket.emit('search:leave', { searchId });
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
