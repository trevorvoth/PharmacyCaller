import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { searchApi, pharmacyApi, type SearchStatus } from '../services/api';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useToast } from '../components/Toast';
import { useTwilioDevice } from '../hooks/useTwilioDevice';
import SearchHeader from '../components/SearchHeader';
import PharmacyList, { type PharmacyItem } from '../components/PharmacyList';
import PharmacyMap from '../components/PharmacyMap';
import MapListLayout from '../components/MapListLayout';
import CallOverlay, { type CallPhase } from '../components/CallOverlay';
import { type PharmacyStatus } from '../components/PharmacyCard';

interface ActiveCall {
  callId: string;
  pharmacyId: string;
  pharmacyName: string;
  conferenceName: string;
}

export default function SearchPage() {
  const { searchId } = useParams<{ searchId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { joinSearch, leaveSearch, onSearchUpdate, onPharmacistReady, onCallStateChange, onCallConnect } = useWebSocket();
  const { deviceState, isMuted, error: deviceError, connect, disconnect, toggleMute, sendDigits } = useTwilioDevice();

  const [search, setSearch] = useState<SearchStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [highlightedPharmacyId, setHighlightedPharmacyId] = useState<string | null>(null);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // Call overlay state
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callPhase, setCallPhase] = useState<CallPhase>('dialing');
  const [callStartTime, setCallStartTime] = useState(0);

  // Track pharmacy list refs for scrolling
  const pharmacyRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Track whether we've already restored an active call from the API (avoid re-triggering on polls)
  const activeCallRestoredRef = useRef(false);

  // Get user's current location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        () => {
          // Silently fail - we'll use search location as fallback
        }
      );
    }
  }, []);

  // Fetch search data and poll for updates
  useEffect(() => {
    if (!searchId) return;

    let isCancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await searchApi.getStatus(searchId);
        if (!isCancelled) {
          setSearch(res.data);
          setError('');

          // If the API reports an active call and we haven't restored one yet,
          // set it up (fixes race condition where call_connect fires before we join the WS room)
          if (res.data.activeCall && !activeCallRestoredRef.current) {
            activeCallRestoredRef.current = true;
            const ac = res.data.activeCall;
            setActiveCall({
              callId: ac.callId,
              pharmacyId: ac.pharmacyId,
              pharmacyName: ac.pharmacyName,
              conferenceName: ac.conferenceName,
            });
            setCallPhase('ringing');
            setHighlightedPharmacyId(ac.pharmacyId);
            setSelectedPharmacyId(ac.pharmacyId);
          }
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          const axiosError = err as { response?: { data?: { error?: string } } };
          setError(axiosError.response?.data?.error || 'Failed to load search');
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    // Initial fetch
    void fetchStatus();

    // Poll every 3 seconds
    const interval = setInterval(() => {
      void fetchStatus();
    }, 3000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [searchId]);

  // Join WebSocket room for real-time updates
  useEffect(() => {
    if (!searchId) return;

    joinSearch(searchId);
    return () => leaveSearch(searchId);
  }, [searchId, joinSearch, leaveSearch]);

  // Handle search updates
  useEffect(() => {
    return onSearchUpdate((data) => {
      if (data.searchId !== searchId) return;

      setSearch((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: data.status.toUpperCase() as 'ACTIVE' | 'COMPLETED' | 'CANCELLED',
          activeCalls: data.activeCalls,
          readyCalls: data.connectedCalls,
        };
      });
    });
  }, [searchId, onSearchUpdate]);

  // Handle pharmacist ready notifications (legacy - kept for compatibility)
  useEffect(() => {
    return onPharmacistReady((data) => {
      if (data.searchId !== searchId) return;

      // Highlight the pharmacy
      setHighlightedPharmacyId(data.pharmacyId);
      setSelectedPharmacyId(data.pharmacyId);

      // Remove highlight after 10 seconds
      setTimeout(() => {
        setHighlightedPharmacyId((current) =>
          current === data.pharmacyId ? null : current
        );
      }, 10000);
    });
  }, [searchId, onPharmacistReady]);

  // Handle call state changes
  useEffect(() => {
    return onCallStateChange((data) => {
      if (data.searchId !== searchId) return;

      setSearch((prev) => {
        if (!prev) return prev;

        const pharmacies = prev.pharmacies.map((p) => {
          if (p.callId === data.callId) {
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
  }, [searchId, onCallStateChange]);

  // Handle call_connect events - show overlay with Answer button
  useEffect(() => {
    console.log('[SearchPage] Setting up call_connect listener for searchId:', searchId);

    return onCallConnect((data) => {
      console.log('[SearchPage] call_connect event received:', data);
      if (data.searchId !== searchId) {
        console.log('[SearchPage] Ignoring - searchId mismatch:', data.searchId, '!==', searchId);
        return;
      }

      console.log('[SearchPage] call_connect received:', data);

      // Mark as restored so the poll doesn't redundantly set it up
      activeCallRestoredRef.current = true;

      // Set active call state - show overlay with Answer button
      setActiveCall({
        callId: data.callId,
        pharmacyId: data.pharmacyId,
        pharmacyName: data.pharmacyName,
        conferenceName: data.conferenceName,
      });
      setCallPhase('ringing'); // Show Answer button first

      // Highlight this pharmacy
      setHighlightedPharmacyId(data.pharmacyId);
      setSelectedPharmacyId(data.pharmacyId);

      // Scroll to the pharmacy
      const ref = pharmacyRefs.current.get(data.pharmacyId);
      if (ref) {
        ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }, [searchId, onCallConnect]);

  // Handle Answer button click - connects to the conference (user gesture enables audio)
  const handleAnswer = useCallback(() => {
    if (!activeCall) return;
    setCallPhase('dialing');
    void connect(activeCall.conferenceName);
  }, [activeCall, connect]);

  // Track device state changes for the call overlay
  useEffect(() => {
    if (!activeCall) return;

    if (deviceState === 'connecting') {
      setCallPhase('dialing');
    } else if (deviceState === 'connected') {
      setCallPhase('connected');
      setCallStartTime(Date.now());
    } else if (deviceState === 'disconnected' && callPhase === 'connected') {
      setCallPhase('ended');
    } else if (deviceState === 'error') {
      setCallPhase('error');
    }
  }, [deviceState, activeCall, callPhase]);

  const handleHangUp = useCallback(() => {
    disconnect();
    setCallPhase('ended');
  }, [disconnect]);

  const handleOverlayMarkFound = useCallback(async () => {
    if (!searchId || !activeCall) return;

    try {
      await searchApi.markFound(searchId, activeCall.pharmacyId);
      addToast('Medication found!', 'success');
      setActiveCall(null);
      activeCallRestoredRef.current = false;
    } catch {
      addToast('Failed to mark as found', 'error');
    }
  }, [searchId, activeCall, addToast]);

  const handleOverlayMarkNotFound = useCallback(async () => {
    if (!activeCall) return;

    // Disconnect if currently in a call
    disconnect();

    try {
      await pharmacyApi.markNotFound(activeCall.pharmacyId);
      addToast('Marked as not available — calling next pharmacy', 'info');
      setActiveCall(null);
      activeCallRestoredRef.current = false;
      setCallPhase('ringing');
    } catch {
      addToast('Failed to update status', 'error');
    }
  }, [activeCall, disconnect, addToast]);

  const handleMarkNotFound = useCallback(
    async (pharmacyId: string) => {
      try {
        await pharmacyApi.markNotFound(pharmacyId);
        addToast('Marked as not available', 'info');
      } catch {
        addToast('Failed to update status', 'error');
      }
    },
    [addToast]
  );

  const handleCancel = useCallback(async () => {
    if (!searchId) return;

    try {
      // Disconnect active call if any
      if (activeCall) {
        disconnect();
        setActiveCall(null);
        activeCallRestoredRef.current = false;
      }
      await searchApi.cancel(searchId);
      addToast('Search cancelled', 'info');
    } catch {
      addToast('Failed to cancel search', 'error');
    }
  }, [searchId, activeCall, disconnect, addToast]);

  const handleMarkFound = useCallback(async () => {
    if (!searchId || !search) return;

    // If there's an active call, mark that pharmacy
    if (activeCall) {
      await handleOverlayMarkFound();
      return;
    }

    // Find a pharmacy with medication or that's connected
    const foundPharmacy = search.pharmacies.find(
      (p) => p.hasMedication === true || p.status === 'connected'
    );

    if (!foundPharmacy) {
      addToast('Select a pharmacy first', 'warning');
      return;
    }

    try {
      await searchApi.markFound(searchId, foundPharmacy.pharmacyId);
      addToast('Medication found!', 'success');
    } catch {
      addToast('Failed to mark as found', 'error');
    }
  }, [searchId, search, activeCall, handleOverlayMarkFound, addToast]);

  // Handle pharmacy selection from map
  const handlePharmacySelect = useCallback((pharmacyId: string) => {
    setSelectedPharmacyId(pharmacyId);
    // Scroll to the pharmacy in the list
    const ref = pharmacyRefs.current.get(pharmacyId);
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // Handle pharmacy click from list (for bidirectional highlight)
  const handlePharmacyClick = useCallback((pharmacyId: string) => {
    setSelectedPharmacyId(pharmacyId);
  }, []);

  // Register pharmacy ref for scrolling
  const registerPharmacyRef = useCallback((pharmacyId: string, ref: HTMLDivElement | null) => {
    if (ref) {
      pharmacyRefs.current.set(pharmacyId, ref);
    } else {
      pharmacyRefs.current.delete(pharmacyId);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">Loading search...</div>
      </div>
    );
  }

  if (error || !search) {
    return (
      <div className="bg-red-50 dark:bg-red-950 rounded-lg p-6 text-center">
        <p className="text-red-600 dark:text-red-400">{error || 'Search not found'}</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="mt-4 text-sm text-primary-500 hover:text-primary-600"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Deduplicate pharmacies by name+address (OSM can return both node + way for same location)
  // When duplicates exist, prefer the one with an active call status
  const seen = new Map<string, number>();
  const pharmacies: PharmacyItem[] = [];
  for (const p of search.pharmacies) {
    const key = `${p.pharmacyName.toLowerCase()}|${p.address.toLowerCase()}`;
    const item: PharmacyItem = {
      pharmacyId: p.pharmacyId,
      pharmacyName: p.pharmacyName,
      address: p.address,
      phone: p.phone,
      phoneSource: p.phoneSource,
      status: p.hasMedication === false ? 'completed' : mapSearchStatusToPharmacyStatus(p.status, p.isHumanReady, p.isVoicemailReady),
      hasMedication: p.hasMedication,
      callId: p.callId ?? p.pharmacyId,
      distance: p.distance,
    };
    const existingIdx = seen.get(key);
    if (existingIdx === undefined) {
      seen.set(key, pharmacies.length);
      pharmacies.push(item);
    } else if (item.status !== 'pending' && pharmacies[existingIdx]?.status === 'pending') {
      // Replace pending duplicate with the one that has an active status
      pharmacies[existingIdx] = item;
    }
  }

  return (
    <div className="space-y-6">
      <SearchHeader
        medicationQuery={search.medicationQuery}
        status={search.status}
        activeCalls={search.activeCalls}
        readyCalls={search.readyCalls}
        totalPharmacies={search.pharmacies.length}
        onCancel={search.status === 'ACTIVE' ? handleCancel : undefined}
        onMarkFound={search.status === 'ACTIVE' ? handleMarkFound : undefined}
      />

      <MapListLayout
        map={
          <PharmacyMap
            pharmacies={search.pharmacies}
            searchLocation={search.searchLocation}
            userLocation={userLocation}
            selectedPharmacyId={selectedPharmacyId}
            onPharmacySelect={handlePharmacySelect}
            onJoinCall={undefined}
            onMarkNotFound={handleMarkNotFound}
          />
        }
        list={
          <PharmacyList
            pharmacies={pharmacies}
            highlightedPharmacyId={highlightedPharmacyId}
            selectedPharmacyId={selectedPharmacyId}
            onJoinCall={undefined}
            onMarkNotFound={handleMarkNotFound}
            onPharmacyClick={handlePharmacyClick}
            registerRef={registerPharmacyRef}
          />
        }
      />

      {/* Call Overlay - floating panel when a call is active */}
      {activeCall && (
        <CallOverlay
          pharmacyName={activeCall.pharmacyName}
          callPhase={callPhase}
          callStartTime={callStartTime}
          isMuted={isMuted}
          error={deviceError}
          onToggleMute={toggleMute}
          onHangUp={handleHangUp}
          onMarkFound={handleOverlayMarkFound}
          onMarkNotFound={handleOverlayMarkNotFound}
          onAnswer={handleAnswer}
          onSendDigits={sendDigits}
        />
      )}
    </div>
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
