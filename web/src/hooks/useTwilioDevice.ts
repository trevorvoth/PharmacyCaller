import { useState, useEffect, useCallback, useRef } from 'react';
import { Device, Call } from '@twilio/voice-sdk';
import { tokenApi } from '../services/api';

type DeviceState = 'initializing' | 'ready' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseTwilioDeviceReturn {
  deviceState: DeviceState;
  isMuted: boolean;
  error: string | null;
  connect: (conferenceName: string) => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
}

export function useTwilioDevice(): UseTwilioDeviceReturn {
  // Start as 'ready' - we'll initialize device lazily on first connect
  const [deviceState, setDeviceState] = useState<DeviceState>('ready');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState<boolean | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Fetch token and check demo mode on mount (but don't register device yet)
  useEffect(() => {
    let mounted = true;

    const fetchToken = async () => {
      try {
        const res = await tokenApi.getToken();
        const { token, demoMode } = res.data;

        if (mounted) {
          tokenRef.current = token;
          setIsDemoMode(demoMode ?? false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch token');
        }
      }
    };

    void fetchToken();

    return () => {
      mounted = false;
      if (deviceRef.current) {
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
    };
  }, []);

  const connect = useCallback(async (conferenceName: string) => {
    // Demo mode: simulate connection
    if (isDemoMode) {
      setDeviceState('connecting');
      setError(null);
      // Simulate brief connection delay
      setTimeout(() => {
        setDeviceState('connected');
      }, 500);
      return;
    }

    // Token not ready yet
    if (!tokenRef.current) {
      setError('Token not ready');
      return;
    }

    try {
      setDeviceState('connecting');
      setError(null);

      // Initialize device lazily on first connect (user gesture enables AudioContext)
      if (!deviceRef.current) {
        const device = new Device(tokenRef.current, {
          codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        });

        device.on('error', (err) => {
          setError(err.message || 'Device error');
          setDeviceState('error');
        });

        device.on('tokenWillExpire', async () => {
          try {
            const refreshRes = await tokenApi.getToken();
            device.updateToken(refreshRes.data.token);
            tokenRef.current = refreshRes.data.token;
          } catch {
            setError('Failed to refresh token');
          }
        });

        await device.register();
        deviceRef.current = device;
      }

      const call = await deviceRef.current.connect({
        params: {
          To: conferenceName,
        },
      });

      call.on('accept', () => {
        setDeviceState('connected');
      });

      call.on('disconnect', () => {
        setDeviceState('disconnected');
        callRef.current = null;
      });

      call.on('error', (err) => {
        setError(err.message || 'Call error');
        setDeviceState('error');
      });

      callRef.current = call;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setDeviceState('error');
    }
  }, [isDemoMode]);

  const disconnect = useCallback(() => {
    if (callRef.current) {
      callRef.current.disconnect();
      callRef.current = null;
    }
    setDeviceState('disconnected');
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    if (isDemoMode) {
      setIsMuted((prev) => !prev);
      return;
    }
    if (callRef.current) {
      const newMuted = !isMuted;
      callRef.current.mute(newMuted);
      setIsMuted(newMuted);
    }
  }, [isMuted, isDemoMode]);

  const sendDigits = useCallback((digits: string) => {
    if (callRef.current) {
      callRef.current.sendDigits(digits);
    }
  }, []);

  return {
    deviceState,
    isMuted,
    error,
    connect,
    disconnect,
    toggleMute,
    sendDigits,
  };
}
