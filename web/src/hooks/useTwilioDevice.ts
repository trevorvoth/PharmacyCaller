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
}

export function useTwilioDevice(): UseTwilioDeviceReturn {
  const [deviceState, setDeviceState] = useState<DeviceState>('initializing');
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);

  // Initialize device
  useEffect(() => {
    let mounted = true;

    const initDevice = async () => {
      try {
        const res = await tokenApi.getToken();
        const token = res.data.token;

        const device = new Device(token, {
          codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        });

        device.on('registered', () => {
          if (mounted) setDeviceState('ready');
        });

        device.on('error', (err) => {
          if (mounted) {
            setError(err.message || 'Device error');
            setDeviceState('error');
          }
        });

        device.on('tokenWillExpire', async () => {
          try {
            const refreshRes = await tokenApi.getToken();
            device.updateToken(refreshRes.data.token);
          } catch {
            if (mounted) setError('Failed to refresh token');
          }
        });

        await device.register();
        deviceRef.current = device;
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize device');
          setDeviceState('error');
        }
      }
    };

    initDevice();

    return () => {
      mounted = false;
      if (deviceRef.current) {
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
    };
  }, []);

  const connect = useCallback(async (conferenceName: string) => {
    if (!deviceRef.current) {
      setError('Device not ready');
      return;
    }

    try {
      setDeviceState('connecting');
      setError(null);

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
  }, []);

  const disconnect = useCallback(() => {
    if (callRef.current) {
      callRef.current.disconnect();
      callRef.current = null;
    }
    setDeviceState('disconnected');
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    if (callRef.current) {
      const newMuted = !isMuted;
      callRef.current.mute(newMuted);
      setIsMuted(newMuted);
    }
  }, [isMuted]);

  return {
    deviceState,
    isMuted,
    error,
    connect,
    disconnect,
    toggleMute,
  };
}
