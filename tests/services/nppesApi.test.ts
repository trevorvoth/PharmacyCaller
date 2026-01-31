import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { nppesApiService } from '../../src/services/nppesApi.js';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock logger to suppress output during tests
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs to prevent file writes during tests
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

describe('NPPES API Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchPharmacy', () => {
    it('should find a pharmacy with exact name match', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 1,
          results: [
            {
              number: '1234567890',
              basic: {
                organization_name: 'CVS Pharmacy',
                status: 'A',
                enumeration_date: '2010-01-01',
                last_updated: '2024-01-01',
              },
              addresses: [
                {
                  address_1: '123 Main St',
                  city: 'Los Angeles',
                  state: 'CA',
                  postal_code: '90001',
                  country_code: 'US',
                  telephone_number: '213-555-1234',
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [
                {
                  code: '333600000X',
                  desc: 'Pharmacy',
                  primary: true,
                },
              ],
            },
          ],
        },
      });

      const result = await nppesApiService.searchPharmacy({
        organizationName: 'CVS Pharmacy',
        city: 'Los Angeles',
        state: 'CA',
      });

      expect(result).not.toBeNull();
      expect(result?.npi).toBe('1234567890');
      expect(result?.organizationName).toBe('CVS Pharmacy');
      expect(result?.telephoneNumber).toBe('+12135551234');
      expect(result?.matchScore).toBe(100);
    });

    it('should format phone number to E.164 format', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 1,
          results: [
            {
              number: '1234567890',
              basic: {
                organization_name: 'Walgreens',
                status: 'A',
                enumeration_date: '2010-01-01',
                last_updated: '2024-01-01',
              },
              addresses: [
                {
                  address_1: '456 Oak Ave',
                  city: 'Chicago',
                  state: 'IL',
                  postal_code: '60601',
                  country_code: 'US',
                  telephone_number: '(312) 555-9876',
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [],
            },
          ],
        },
      });

      const result = await nppesApiService.searchPharmacy({
        organizationName: 'Walgreens',
        city: 'Chicago',
        state: 'IL',
      });

      expect(result?.telephoneNumber).toBe('+13125559876');
    });

    it('should prefer LOCATION address over MAILING for phone', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 1,
          results: [
            {
              number: '1234567890',
              basic: {
                organization_name: 'Test Pharmacy',
                status: 'A',
                enumeration_date: '2010-01-01',
                last_updated: '2024-01-01',
              },
              addresses: [
                {
                  address_1: 'PO Box 123',
                  city: 'New York',
                  state: 'NY',
                  postal_code: '10001',
                  country_code: 'US',
                  telephone_number: '212-111-1111',
                  address_purpose: 'MAILING',
                },
                {
                  address_1: '789 Broadway',
                  city: 'New York',
                  state: 'NY',
                  postal_code: '10003',
                  country_code: 'US',
                  telephone_number: '212-222-2222',
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [],
            },
          ],
        },
      });

      const result = await nppesApiService.searchPharmacy({
        organizationName: 'Test Pharmacy',
        city: 'New York',
        state: 'NY',
      });

      expect(result?.telephoneNumber).toBe('+12122222222');
    });

    it('should return null when no results found', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 0,
          results: [],
        },
      });

      const result = await nppesApiService.searchPharmacy({
        organizationName: 'Nonexistent Pharmacy',
        city: 'Nowhere',
        state: 'XX',
      });

      expect(result).toBeNull();
    });

    it('should return null when match score is below threshold', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 1,
          results: [
            {
              number: '1234567890',
              basic: {
                organization_name: 'Completely Different Name',
                status: 'A',
                enumeration_date: '2010-01-01',
                last_updated: '2024-01-01',
              },
              addresses: [
                {
                  address_1: '123 Main St',
                  city: 'Los Angeles',
                  state: 'CA',
                  postal_code: '90001',
                  country_code: 'US',
                  telephone_number: '213-555-1234',
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [],
            },
          ],
        },
      });

      const result = await nppesApiService.searchPharmacy({
        organizationName: 'CVS Pharmacy Store 1234',
        city: 'Los Angeles',
        state: 'CA',
      });

      expect(result).toBeNull();
    });

    it('should find best match from multiple results', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 3,
          results: [
            {
              number: '1111111111',
              basic: {
                organization_name: 'Rite Aid Corp',
                status: 'A',
                enumeration_date: '2010-01-01',
                last_updated: '2024-01-01',
              },
              addresses: [
                {
                  address_1: '100 Corp Dr',
                  city: 'Seattle',
                  state: 'WA',
                  postal_code: '98101',
                  country_code: 'US',
                  telephone_number: '206-111-1111',
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [],
            },
            {
              number: '2222222222',
              basic: {
                organization_name: 'Rite Aid Pharmacy 5678',
                status: 'A',
                enumeration_date: '2010-01-01',
                last_updated: '2024-01-01',
              },
              addresses: [
                {
                  address_1: '456 Pine St',
                  city: 'Seattle',
                  state: 'WA',
                  postal_code: '98102',
                  country_code: 'US',
                  telephone_number: '206-222-2222',
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [],
            },
            {
              number: '3333333333',
              basic: {
                organization_name: 'Different Store',
                status: 'A',
                enumeration_date: '2010-01-01',
                last_updated: '2024-01-01',
              },
              addresses: [
                {
                  address_1: '789 Oak Ave',
                  city: 'Seattle',
                  state: 'WA',
                  postal_code: '98103',
                  country_code: 'US',
                  telephone_number: '206-333-3333',
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [],
            },
          ],
        },
      });

      const result = await nppesApiService.searchPharmacy({
        organizationName: 'Rite Aid Pharmacy',
        city: 'Seattle',
        state: 'WA',
      });

      expect(result).not.toBeNull();
      // Should match the one with "Rite Aid Pharmacy 5678" due to higher similarity
      expect(result?.npi).toBe('2222222222');
    });

    it('should handle API errors gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
      mockedAxios.isAxiosError = vi.fn().mockReturnValue(false);

      const result = await nppesApiService.searchPharmacy({
        organizationName: 'Test Pharmacy',
        city: 'Test City',
        state: 'TS',
      });

      expect(result).toBeNull();
    });

    it('should handle axios errors with response', async () => {
      const axiosError = {
        response: { status: 500 },
        message: 'Server error',
      };
      mockedAxios.get.mockRejectedValueOnce(axiosError);
      mockedAxios.isAxiosError = vi.fn().mockReturnValue(true);

      const result = await nppesApiService.searchPharmacy({
        organizationName: 'Test Pharmacy',
        city: 'Test City',
        state: 'TS',
      });

      expect(result).toBeNull();
    });

    it('should return null when pharmacy has no phone number', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 1,
          results: [
            {
              number: '1234567890',
              basic: {
                organization_name: 'No Phone Pharmacy',
                status: 'A',
                enumeration_date: '2010-01-01',
                last_updated: '2024-01-01',
              },
              addresses: [
                {
                  address_1: '123 Main St',
                  city: 'Los Angeles',
                  state: 'CA',
                  postal_code: '90001',
                  country_code: 'US',
                  // No telephone_number field
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [],
            },
          ],
        },
      });

      const result = await nppesApiService.searchPharmacy({
        organizationName: 'No Phone Pharmacy',
        city: 'Los Angeles',
        state: 'CA',
      });

      expect(result).not.toBeNull();
      expect(result?.telephoneNumber).toBeNull();
    });
  });

  describe('batchLookupPhones', () => {
    it('should lookup phones for multiple pharmacies', async () => {
      // First pharmacy - has phone
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 1,
          results: [
            {
              number: '1111111111',
              basic: { organization_name: 'CVS Pharmacy' },
              addresses: [
                {
                  address_1: '123 Main St',
                  city: 'Los Angeles',
                  state: 'CA',
                  postal_code: '90001',
                  country_code: 'US',
                  telephone_number: '213-111-1111',
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [],
            },
          ],
        },
      });

      // Second pharmacy - has phone
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 1,
          results: [
            {
              number: '2222222222',
              basic: { organization_name: 'Walgreens' },
              addresses: [
                {
                  address_1: '456 Oak Ave',
                  city: 'Chicago',
                  state: 'IL',
                  postal_code: '60601',
                  country_code: 'US',
                  telephone_number: '312-222-2222',
                  address_purpose: 'LOCATION',
                },
              ],
              taxonomies: [],
            },
          ],
        },
      });

      // Third pharmacy - no results
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          result_count: 0,
          results: [],
        },
      });

      const pharmacies = [
        { name: 'CVS Pharmacy', city: 'Los Angeles', state: 'CA' },
        { name: 'Walgreens', city: 'Chicago', state: 'IL' },
        { name: 'Unknown Pharmacy', city: 'Nowhere', state: 'XX' },
      ];

      const results = await nppesApiService.batchLookupPhones(pharmacies);

      expect(results.size).toBe(2);
      expect(results.get('CVS Pharmacy')).toBe('+12131111111');
      expect(results.get('Walgreens')).toBe('+13122222222');
      expect(results.has('Unknown Pharmacy')).toBe(false);
    });

    it('should return empty map for empty input', async () => {
      const results = await nppesApiService.batchLookupPhones([]);
      expect(results.size).toBe(0);
    });

    it('should handle all failures gracefully', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));
      mockedAxios.isAxiosError = vi.fn().mockReturnValue(false);

      const pharmacies = [
        { name: 'Pharmacy 1', city: 'City 1', state: 'S1' },
        { name: 'Pharmacy 2', city: 'City 2', state: 'S2' },
      ];

      const results = await nppesApiService.batchLookupPhones(pharmacies);
      expect(results.size).toBe(0);
    });

    it('should respect concurrency limit', async () => {
      // Track concurrent requests
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockedAxios.get.mockImplementation(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 10));

        currentConcurrent--;
        return {
          data: {
            result_count: 0,
            results: [],
          },
        };
      });

      const pharmacies = Array.from({ length: 9 }, (_, i) => ({
        name: `Pharmacy ${i}`,
        city: `City ${i}`,
        state: 'XX',
      }));

      await nppesApiService.batchLookupPhones(pharmacies);

      // Concurrency is set to 3 in the service
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });
  });
});

describe('Name Match Scoring', () => {
  // These tests verify the scoring algorithm by observing behavior
  // through the searchPharmacy function

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should give 100 score for exact match', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        result_count: 1,
        results: [
          {
            number: '1234567890',
            basic: { organization_name: 'CVS Pharmacy' },
            addresses: [
              {
                address_1: '123 Main St',
                city: 'LA',
                state: 'CA',
                postal_code: '90001',
                country_code: 'US',
                telephone_number: '213-555-1234',
                address_purpose: 'LOCATION',
              },
            ],
            taxonomies: [],
          },
        ],
      },
    });

    const result = await nppesApiService.searchPharmacy({
      organizationName: 'CVS Pharmacy',
      city: 'LA',
      state: 'CA',
    });

    expect(result?.matchScore).toBe(100);
  });

  it('should give high score for partial containment', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        result_count: 1,
        results: [
          {
            number: '1234567890',
            basic: { organization_name: 'CVS Pharmacy Store 1234' },
            addresses: [
              {
                address_1: '123 Main St',
                city: 'LA',
                state: 'CA',
                postal_code: '90001',
                country_code: 'US',
                telephone_number: '213-555-1234',
                address_purpose: 'LOCATION',
              },
            ],
            taxonomies: [],
          },
        ],
      },
    });

    const result = await nppesApiService.searchPharmacy({
      organizationName: 'CVS Pharmacy',
      city: 'LA',
      state: 'CA',
    });

    expect(result?.matchScore).toBe(80);
  });
});
