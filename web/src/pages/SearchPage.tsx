import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { searchApi, callApi, pharmacyApi, type SearchStatus } from '../services/api';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useToast } from '../components/Toast';
import SearchHeader from '../components/SearchHeader';
import PharmacyList, { type PharmacyItem } from '../components/PharmacyList';
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

  // Fetch initial search data
  useEffect(() => {
    if (!searchId) return;

    searchApi
      .getStatus(searchId)
      .then((res) => {
        setSearch(res.data);
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Failed to load search');
      })
      .finally(() => {
        setIsLoading(false);
      });
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
          if (p.pharmacyId === data.callId.split('-')[0]) {
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
    status: mapSearchStatusToPharmacyStatus(p.status, p.isHumanReady, p.isVoicemailReady),
    hasMedication: p.hasMedication,
    callId: p.pharmacyId, // Assuming callId matches pharmacyId for now
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

      <PharmacyList
        pharmacies={pharmacies}
        highlightedPharmacyId={highlightedPharmacyId}
        onJoinCall={handleJoinCall}
        onMarkNotFound={handleMarkNotFound}
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
