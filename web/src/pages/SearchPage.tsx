import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { searchApi, callApi, pharmacyApi, type SearchStatus } from '../services/api';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useToast } from '../components/Toast';
import SearchHeader from '../components/SearchHeader';
import PharmacyList, { type PharmacyItem } from '../components/PharmacyList';
import PharmacyMap from '../components/PharmacyMap';
import MapListLayout from '../components/MapListLayout';
import { type PharmacyStatus } from '../components/PharmacyCard';

export default function SearchPage() {
  const { searchId } = useParams<{ searchId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { joinSearch, leaveSearch, onSearchUpdate, onPharmacistReady, onCallStateChange } = useWebSocket();

  const [search, setSearch] = useState<SearchStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [highlightedPharmacyId, setHighlightedPharmacyId] = useState<string | null>(null);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // Track pharmacy list refs for scrolling
  const pharmacyRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  // Handle pharmacist ready notifications
  useEffect(() => {
    return onPharmacistReady((data) => {
      if (data.searchId !== searchId) return;

      // Highlight the pharmacy
      setHighlightedPharmacyId(data.pharmacyId);
      setSelectedPharmacyId(data.pharmacyId);

      // Scroll to the pharmacy in the list
      const ref = pharmacyRefs.current.get(data.pharmacyId);
      if (ref) {
        ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Show toast notification
      addToast(
        `${data.pharmacyName} is ready to talk!`,
        'success',
        {
          label: 'Join Call',
          onClick: () => handleJoinCall(data.callId, data.pharmacyId),
        }
      );

      // Remove highlight after 10 seconds
      setTimeout(() => {
        setHighlightedPharmacyId((current) =>
          current === data.pharmacyId ? null : current
        );
      }, 10000);
    });
  }, [searchId, onPharmacistReady, addToast]);

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

  const handleJoinCall = useCallback(
    async (callId: string, _pharmacyId: string) => {
      try {
        await callApi.join(callId);
        navigate(`/call/${callId}`);
      } catch (err) {
        addToast('Failed to join call', 'error');
      }
    },
    [navigate, addToast]
  );

  const handleMarkNotFound = useCallback(
    async (pharmacyId: string) => {
      try {
        await pharmacyApi.markNotFound(pharmacyId);
        addToast('Marked as not available', 'info');
      } catch (err) {
        addToast('Failed to update status', 'error');
      }
    },
    [addToast]
  );

  const handleCancel = useCallback(async () => {
    if (!searchId) return;

    try {
      await searchApi.cancel(searchId);
      addToast('Search cancelled', 'info');
    } catch (err) {
      addToast('Failed to cancel search', 'error');
    }
  }, [searchId, addToast]);

  const handleMarkFound = useCallback(async () => {
    if (!searchId || !search) return;

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
    } catch (err) {
      addToast('Failed to mark as found', 'error');
    }
  }, [searchId, search, addToast]);

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

  const pharmacies: PharmacyItem[] = search.pharmacies.map((p) => ({
    pharmacyId: p.pharmacyId,
    pharmacyName: p.pharmacyName,
    address: p.address,
    status: p.hasMedication === false ? 'completed' : mapSearchStatusToPharmacyStatus(p.status, p.isHumanReady, p.isVoicemailReady),
    hasMedication: p.hasMedication,
    callId: p.callId ?? p.pharmacyId,
    distance: p.distance,
  }));

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
            onJoinCall={(pharmacyId, callId) => handleJoinCall(callId, pharmacyId)}
            onMarkNotFound={handleMarkNotFound}
          />
        }
        list={
          <PharmacyList
            pharmacies={pharmacies}
            highlightedPharmacyId={highlightedPharmacyId}
            selectedPharmacyId={selectedPharmacyId}
            onJoinCall={handleJoinCall}
            onMarkNotFound={handleMarkNotFound}
            onPharmacyClick={handlePharmacyClick}
            registerRef={registerPharmacyRef}
          />
        }
      />
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
