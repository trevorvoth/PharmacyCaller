import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchApi, type StartSearchRequest } from '../services/api';
import Button from '../components/Button';
import Input from '../components/Input';
import Card, { CardContent } from '../components/Card';

interface SearchHistoryItem {
  id: string;
  medicationQuery: string;
  status: string;
  createdAt: string;
  pharmacyCount: number;
  foundCount: number;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [medicationQuery, setMedicationQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState('');

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        () => {
          setLocationError('Location access denied. Please enable location services.');
        }
      );
    } else {
      setLocationError('Geolocation is not supported by your browser.');
    }

    searchApi
      .getHistory()
      .then((res) => {
        setHistory(res.data.searches || []);
      })
      .catch(() => {
        // Silently fail on history load
      })
      .finally(() => {
        setIsLoadingHistory(false);
      });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!location) {
      setError('Location is required to search for nearby pharmacies.');
      return;
    }

    if (!medicationQuery.trim()) {
      setError('Please enter a medication name.');
      return;
    }

    setIsLoading(true);

    try {
      const data: StartSearchRequest = {
        medicationQuery: medicationQuery.trim(),
        latitude: location.latitude,
        longitude: location.longitude,
      };

      const res = await searchApi.start(data);
      navigate(`/search/${res.data.searchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start search');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Find Your Medication
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          We'll call nearby pharmacies to check availability
        </p>
      </div>

      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-md">
                {error}
              </div>
            )}
            {locationError && (
              <div className="p-3 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950 rounded-md">
                {locationError}
              </div>
            )}
            <Input
              label="Medication Name"
              type="text"
              value={medicationQuery}
              onChange={(e) => setMedicationQuery(e.target.value)}
              placeholder="e.g., Adderall 20mg, Ozempic, Metformin"
              required
            />
            <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
              {location ? (
                <>
                  <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Location detected</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Getting location...</span>
                </>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              isLoading={isLoading}
              disabled={!location || isLoading}
            >
              Start Calling Pharmacies
            </Button>
          </form>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Recent Searches
        </h2>
        {isLoadingHistory ? (
          <div className="text-gray-500 dark:text-gray-400">Loading...</div>
        ) : history.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                No previous searches. Start your first search above!
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <Card
                key={item.id}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                onClick={() => navigate(`/search/${item.id}`)}
              >
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {item.medicationQuery}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(item.createdAt).toLocaleDateString()} &middot; {item.pharmacyCount} pharmacies
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      {item.foundCount > 0 && (
                        <span className="px-2 py-1 text-xs font-medium text-primary-600 bg-primary-50 dark:bg-primary-950 dark:text-primary-400 rounded-full">
                          Found at {item.foundCount}
                        </span>
                      )}
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${
                          item.status === 'COMPLETED'
                            ? 'text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-400'
                            : item.status === 'ACTIVE'
                            ? 'text-primary-600 bg-primary-50 dark:bg-primary-950 dark:text-primary-400'
                            : 'text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-400'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
