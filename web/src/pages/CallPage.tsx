import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { callApi, searchApi, pharmacyApi, type CallStatus, type SearchStatus } from '../services/api';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useTwilioDevice } from '../hooks/useTwilioDevice';
import SplitLayout from '../components/SplitLayout';
import CallTimer from '../components/CallTimer';
import CallControls from '../components/CallControls';
import CallSummary from '../components/CallSummary';
import PharmacyList, { type PharmacyItem } from '../components/PharmacyList';
import { type PharmacyStatus } from '../components/PharmacyCard';

type PageState = 'loading' | 'connecting' | 'active' | 'ended' | 'error';

export default function CallPage() {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();
  const { joinSearch, leaveSearch, onCallStateChange } = useWebSocket();
  const { deviceState, isMuted, error: deviceError, connect, disconnect, toggleMute } = useTwilioDevice();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [call, setCall] = useState<CallStatus | null>(null);
  const [search, setSearch] = useState<SearchStatus | null>(null);
  const [error, setError] = useState('');
  const [callStartTime, setCallStartTime] = useState<number>(0);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Fetch call and search data
  useEffect(() => {
    if (!callId) return;

    const fetchData = async () => {
      try {
        const callRes = await callApi.getStatus(callId);
        setCall(callRes.data);

        const searchRes = await searchApi.getStatus(callRes.data.searchId);
        setSearch(searchRes.data);

        setPageState('connecting');
      } catch (err) {
        setError('Failed to load call data');
        setPageState('error');
      }
    };

    fetchData();
  }, [callId]);

  // Join WebSocket room
  useEffect(() => {
    if (!call?.searchId) return;

    joinSearch(call.searchId);
    return () => leaveSearch(call.searchId);
  }, [call?.searchId, joinSearch, leaveSearch]);

  // Connect to Twilio when device is ready
  useEffect(() => {
    if (deviceState === 'ready' && pageState === 'connecting' && call) {
      connect(`conference:${call.searchId}:${callId}`);
    }
  }, [deviceState, pageState, call, callId, connect]);

  // Track device state changes
  useEffect(() => {
    if (deviceState === 'connected') {
      setPageState('active');
      setCallStartTime(Date.now());
    } else if (deviceState === 'disconnected' && pageState === 'active') {
      setCallDuration(Math.floor((Date.now() - callStartTime) / 1000));
      setPageState('ended');
    } else if (deviceState === 'error') {
      setError(deviceError || 'Connection error');
      setPageState('error');
    }
  }, [deviceState, pageState, callStartTime, deviceError]);

  // Listen for call state updates
  useEffect(() => {
    return onCallStateChange((data) => {
      if (!search) return;

      setSearch((prev) => {
        if (!prev) return prev;

        const pharmacies = prev.pharmacies.map((p) => {
          if (p.pharmacyId === data.callId) {
            return {
              ...p,
              status: mapCallStateToStatus(data.newState),
            };
          }
          return p;
        });

        return { ...prev, pharmacies };
      });
    });
  }, [search, onCallStateChange]);

  const handleEndCall = useCallback(() => {
    disconnect();
    if (callId) {
      callApi.end(callId).catch(() => {});
    }
  }, [callId, disconnect]);

  const handleMarkFound = useCallback(async () => {
    if (!call || !search) return;

    setIsActionLoading(true);
    try {
      await searchApi.markFound(search.id, call.pharmacyId);
      navigate(`/search/${search.id}`);
    } catch {
      setError('Failed to mark as found');
    } finally {
      setIsActionLoading(false);
    }
  }, [call, search, navigate]);

  const handleMarkNotAvailable = useCallback(async () => {
    if (!call || !search) return;

    setIsActionLoading(true);
    try {
      await pharmacyApi.markNotFound(call.pharmacyId);
      navigate(`/search/${search.id}`);
    } catch {
      setError('Failed to update status');
    } finally {
      setIsActionLoading(false);
    }
  }, [call, search, navigate]);

  const handleSkip = useCallback(() => {
    if (search) {
      navigate(`/search/${search.id}`);
    } else {
      navigate('/dashboard');
    }
  }, [search, navigate]);

  // Loading state
  if (pageState === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">Loading call...</div>
      </div>
    );
  }

  // Error state
  if (pageState === 'error') {
    return (
      <div className="bg-red-50 dark:bg-red-950 rounded-lg p-6 text-center">
        <p className="text-red-600 dark:text-red-400">{error || 'Something went wrong'}</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="mt-4 text-sm text-primary-500 hover:text-primary-600"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Call ended - show summary
  if (pageState === 'ended' && call) {
    return (
      <div className="flex items-center justify-center py-12">
        <CallSummary
          pharmacyName={call.pharmacyName}
          duration={callDuration}
          onMarkFound={handleMarkFound}
          onMarkNotAvailable={handleMarkNotAvailable}
          onSkip={handleSkip}
          isLoading={isActionLoading}
        />
      </div>
    );
  }

  // Prepare pharmacy list for right panel
  const pharmacies: PharmacyItem[] = search?.pharmacies.map((p) => ({
    pharmacyId: p.pharmacyId,
    pharmacyName: p.pharmacyName,
    address: p.address,
    status: mapSearchStatusToPharmacyStatus(p.status, p.isHumanReady, p.isVoicemailReady),
    hasMedication: p.hasMedication,
  })) || [];

  // Active call or connecting
  return (
    <SplitLayout
      leftWidth="40%"
      left={
        <div className="bg-white dark:bg-gray-900 rounded-lg p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">
            {call?.pharmacyName || 'Connecting...'}
          </h2>

          <div className="mb-8">
            {pageState === 'connecting' ? (
              <div className="text-2xl text-gray-400 dark:text-gray-500 animate-pulse">
                Connecting...
              </div>
            ) : (
              <CallTimer startTime={callStartTime} isActive={pageState === 'active'} />
            )}
          </div>

          <CallControls
            isMuted={isMuted}
            onMuteToggle={toggleMute}
            onEndCall={handleEndCall}
            isEnding={false}
          />
        </div>
      }
      right={
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Other Pharmacies
          </h3>
          <PharmacyList
            pharmacies={pharmacies.filter((p) => p.pharmacyId !== call?.pharmacyId)}
            onJoinCall={undefined}
            onMarkNotFound={undefined}
          />
        </div>
      }
    />
  );
}

function mapSearchStatusToPharmacyStatus(
  status: string,
  isHumanReady: boolean,
  isVoicemailReady: boolean
): PharmacyStatus {
  if (isHumanReady) return 'ready';
  if (isVoicemailReady) return 'voicemail';

  const statusMap: Record<string, PharmacyStatus> = {
    pending: 'pending',
    calling: 'calling',
    on_hold: 'on_hold',
    ready: 'ready',
    connected: 'connected',
    completed: 'completed',
    failed: 'failed',
  };

  return statusMap[status] || 'pending';
}

function mapCallStateToStatus(state: string): PharmacyStatus {
  const stateMap: Record<string, PharmacyStatus> = {
    CREATED: 'pending',
    DIALING: 'calling',
    RINGING: 'calling',
    IN_PROGRESS: 'calling',
    IVR: 'calling',
    HOLD: 'on_hold',
    HUMAN_DETECTED: 'ready',
    VOICEMAIL: 'voicemail',
    READY: 'ready',
    CONNECTED: 'connected',
    COMPLETED: 'completed',
    FAILED: 'failed',
    NO_ANSWER: 'failed',
    BUSY: 'failed',
  };

  return stateMap[state] || 'pending';
}
