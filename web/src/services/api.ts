import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export interface StartSearchRequest {
  medicationQuery: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  maxPharmacies?: number;
}

export interface PharmacyResult {
  id: string;
  name: string;
  address: string;
  phone: string;
  chain?: string;
}

export interface StartSearchResponse {
  searchId: string;
  medicationQuery: string;
  pharmacies: PharmacyResult[];
  message: string;
}

export interface SearchStatus {
  id: string;
  medicationQuery: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  completedAt: string | null;
  foundAt: string | null;
  activeCalls: number;
  readyCalls: number;
  pharmacies: Array<{
    pharmacyId: string;
    pharmacyName: string;
    address: string;
    status: 'pending' | 'calling' | 'on_hold' | 'ready' | 'connected' | 'completed' | 'failed';
    hasMedication: boolean | null;
    isHumanReady: boolean;
    isVoicemailReady: boolean;
  }>;
}

export interface CallStatus {
  callId: string;
  searchId: string;
  pharmacyId: string;
  pharmacyName: string;
  phoneNumber: string;
  state: string;
  previousState: string | null;
  stateChangedAt: number;
  createdAt: number;
  isQueued: boolean;
  queuedAt?: number;
  notifiedAt?: number;
  acknowledgedAt?: number;
}

export interface JoinCallResponse {
  success: boolean;
  conferenceName: string;
  conferenceSid: string;
  pharmacyName: string;
  message: string;
}

export const searchApi = {
  start: (data: StartSearchRequest) => api.post<StartSearchResponse>('/searches', data),
  getStatus: (searchId: string) => api.get<SearchStatus>(`/searches/${searchId}`),
  markFound: (searchId: string, pharmacyId: string) =>
    api.post(`/searches/${searchId}/found`, { pharmacyId }),
  cancel: (searchId: string) => api.post(`/searches/${searchId}/cancel`),
  getHistory: () => api.get('/searches'),
};

export const callApi = {
  getStatus: (callId: string) => api.get<CallStatus>(`/calls/${callId}`),
  join: (callId: string) => api.post<JoinCallResponse>(`/calls/${callId}/join`),
  end: (callId: string) => api.post(`/calls/${callId}/end`),
  acknowledge: (callId: string) => api.post(`/calls/${callId}/ack`),
  mute: (callId: string, muted: boolean) => api.post(`/calls/${callId}/mute`, { muted }),
};

export const pharmacyApi = {
  markNotFound: (pharmacyId: string) => api.post(`/pharmacies/${pharmacyId}/not-found`),
};

export const tokenApi = {
  getToken: () => api.get<{ token: string; identity: string; expiresIn: number }>('/token'),
};
