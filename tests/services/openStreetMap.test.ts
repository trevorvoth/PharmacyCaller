import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { osmService } from '../../src/services/openStreetMap.js';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OpenStreetMap Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('_buildQuery', () => {
    it('should build valid Overpass query', () => {
      const query = osmService._buildQuery(40.7128, -74.006, 8047);

      expect(query).toContain('[out:json]');
      expect(query).toContain('["amenity"="pharmacy"]');
      expect(query).toContain('around:8047,40.7128,-74.006');
      expect(query).toContain('node');
      expect(query).toContain('way');
    });

    it('should include timeout in query', () => {
      const query = osmService._buildQuery(40.7128, -74.006, 5000);
      expect(query).toContain('[timeout:25]');
    });

    it('should include shop=chemist tag for UK/Europe coverage', () => {
      const query = osmService._buildQuery(40.7128, -74.006, 8047);
      expect(query).toContain('["shop"="chemist"]');
    });

    it('should include shop=pharmacy tag for alternative tagging', () => {
      const query = osmService._buildQuery(40.7128, -74.006, 8047);
      expect(query).toContain('["shop"="pharmacy"]');
    });

    it('should include healthcare=pharmacy tag', () => {
      const query = osmService._buildQuery(40.7128, -74.006, 8047);
      expect(query).toContain('["healthcare"="pharmacy"]');
    });
  });

  describe('_parseElement', () => {
    it('should parse node element correctly', () => {
      const element = {
        type: 'node' as const,
        id: 12345678,
        lat: 40.7128,
        lon: -74.006,
        tags: {
          name: 'CVS Pharmacy',
          'addr:street': 'Broadway',
          'addr:housenumber': '123',
          'addr:city': 'New York',
          'addr:state': 'NY',
          'addr:postcode': '10001',
          phone: '+1-212-555-1234',
          brand: 'CVS Pharmacy',
          opening_hours: 'Mo-Fr 08:00-21:00; Sa 09:00-18:00',
        },
      };

      const result = osmService._parseElement(element, 40.7, -74.0);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('osm:node:12345678');
      expect(result?.osmId).toBe(12345678);
      expect(result?.osmType).toBe('node');
      expect(result?.name).toBe('CVS Pharmacy');
      expect(result?.address).toBe('123 Broadway, New York, NY 10001');
      expect(result?.phone).toBe('+12125551234');
      expect(result?.latitude).toBe(40.7128);
      expect(result?.longitude).toBe(-74.006);
      expect(result?.brand).toBe('CVS Pharmacy');
      expect(result?.chain).toBe('CVS');
      expect(result?.openingHours).toBe('Mo-Fr 08:00-21:00; Sa 09:00-18:00');
    });

    it('should parse way element using center coordinates', () => {
      const element = {
        type: 'way' as const,
        id: 87654321,
        center: { lat: 34.0522, lon: -118.2437 },
        tags: {
          name: 'Walgreens',
          'addr:street': 'Hollywood Blvd',
          'addr:city': 'Los Angeles',
          'addr:state': 'CA',
          brand: 'Walgreens',
        },
      };

      const result = osmService._parseElement(element, 34.0, -118.0);

      expect(result).not.toBeNull();
      expect(result?.id).toBe('osm:way:87654321');
      expect(result?.osmType).toBe('way');
      expect(result?.latitude).toBe(34.0522);
      expect(result?.longitude).toBe(-118.2437);
      expect(result?.chain).toBe('WALGREENS');
    });

    it('should return null for element without name', () => {
      const element = {
        type: 'node' as const,
        id: 11111111,
        lat: 40.0,
        lon: -74.0,
        tags: {
          'addr:street': 'Main Street',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);
      expect(result).toBeNull();
    });

    it('should use brand as name fallback', () => {
      const element = {
        type: 'node' as const,
        id: 11111112,
        lat: 40.0,
        lon: -74.0,
        tags: {
          brand: 'CVS Pharmacy',
          'addr:street': 'Main Street',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('CVS Pharmacy');
    });

    it('should use operator as name fallback', () => {
      const element = {
        type: 'node' as const,
        id: 11111113,
        lat: 40.0,
        lon: -74.0,
        tags: {
          operator: 'Walgreens Co.',
          'addr:street': 'Oak Avenue',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Walgreens Co.');
    });

    it('should use official_name as name fallback', () => {
      const element = {
        type: 'node' as const,
        id: 11111114,
        lat: 40.0,
        lon: -74.0,
        tags: {
          'official_name': 'Rite Aid Corporation Store #123',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Rite Aid Corporation Store #123');
    });

    it('should prefer name over brand fallback', () => {
      const element = {
        type: 'node' as const,
        id: 11111115,
        lat: 40.0,
        lon: -74.0,
        tags: {
          name: 'CVS Pharmacy #1234',
          brand: 'CVS Pharmacy',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);
      expect(result?.name).toBe('CVS Pharmacy #1234');
    });

    it('should return null for way without center', () => {
      const element = {
        type: 'way' as const,
        id: 22222222,
        tags: {
          name: 'Test Pharmacy',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);
      expect(result).toBeNull();
    });

    it('should handle missing phone number', () => {
      const element = {
        type: 'node' as const,
        id: 33333333,
        lat: 40.0,
        lon: -74.0,
        tags: {
          name: 'Local Pharmacy',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);

      expect(result).not.toBeNull();
      expect(result?.phone).toBeNull();
    });

    it('should use contact:phone as fallback', () => {
      const element = {
        type: 'node' as const,
        id: 44444444,
        lat: 40.0,
        lon: -74.0,
        tags: {
          name: 'Contact Phone Pharmacy',
          'contact:phone': '213-555-9999',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);

      expect(result?.phone).toBe('+12135559999');
    });

    it('should detect chain from name when no brand tag', () => {
      const element = {
        type: 'node' as const,
        id: 55555555,
        lat: 40.0,
        lon: -74.0,
        tags: {
          name: 'Rite Aid Pharmacy #1234',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);

      expect(result?.chain).toBe('RITE_AID');
      expect(result?.brand).toBeNull();
    });

    it('should return null chain for independent pharmacy', () => {
      const element = {
        type: 'node' as const,
        id: 66666666,
        lat: 40.0,
        lon: -74.0,
        tags: {
          name: 'Community Drug Store',
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);

      expect(result?.chain).toBeNull();
    });

    it('should handle invalid phone number format', () => {
      const element = {
        type: 'node' as const,
        id: 77777777,
        lat: 40.0,
        lon: -74.0,
        tags: {
          name: 'Bad Phone Pharmacy',
          phone: '123', // Too short
        },
      };

      const result = osmService._parseElement(element, 40.0, -74.0);

      expect(result?.phone).toBeNull();
    });
  });

  describe('searchPharmaciesNearby', () => {
    it('should search and return pharmacies sorted by distance', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 40.7128,
              lon: -74.006,
              tags: { name: 'Pharmacy A' },
            },
            {
              type: 'node',
              id: 2,
              lat: 40.72,  // Slightly further
              lon: -74.006,
              tags: { name: 'Pharmacy B' },
            },
            {
              type: 'node',
              id: 3,
              lat: 40.7,  // Slightly closer
              lon: -74.006,
              tags: { name: 'Pharmacy C' },
            },
          ],
        },
      });

      const result = await osmService.searchPharmaciesNearby({
        latitude: 40.71,
        longitude: -74.006,
        radiusMeters: 5000,
      });

      expect(result.pharmacies).toHaveLength(3);
      expect(result.totalResults).toBe(3);

      // Should be sorted by distance
      const distances = result.pharmacies.map(p => (p as { distance: number }).distance);
      expect(distances[0]).toBeLessThanOrEqual(distances[1]);
      expect(distances[1]).toBeLessThanOrEqual(distances[2]);
    });

    it('should filter by chain', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 40.7,
              lon: -74.0,
              tags: { name: 'CVS Pharmacy', brand: 'CVS Pharmacy' },
            },
            {
              type: 'node',
              id: 2,
              lat: 40.71,
              lon: -74.0,
              tags: { name: 'Walgreens', brand: 'Walgreens' },
            },
            {
              type: 'node',
              id: 3,
              lat: 40.72,
              lon: -74.0,
              tags: { name: 'Local Pharmacy' },
            },
          ],
        },
      });

      const result = await osmService.searchPharmaciesNearby({
        latitude: 40.7,
        longitude: -74.0,
        radiusMeters: 5000,
        chainFilter: ['CVS'],
      });

      expect(result.pharmacies).toHaveLength(1);
      expect(result.pharmacies[0].name).toBe('CVS Pharmacy');
    });

    it('should handle empty results', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [],
        },
      });

      const result = await osmService.searchPharmaciesNearby({
        latitude: 40.7,
        longitude: -74.0,
        radiusMeters: 1000,
      });

      expect(result.pharmacies).toHaveLength(0);
      expect(result.totalResults).toBe(0);
    });

    it('should skip elements without names', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 40.7,
              lon: -74.0,
              tags: { name: 'Named Pharmacy' },
            },
            {
              type: 'node',
              id: 2,
              lat: 40.71,
              lon: -74.0,
              tags: { 'addr:street': 'Main St' }, // No name
            },
          ],
        },
      });

      const result = await osmService.searchPharmaciesNearby({
        latitude: 40.7,
        longitude: -74.0,
        radiusMeters: 5000,
      });

      expect(result.pharmacies).toHaveLength(1);
      expect(result.pharmacies[0].name).toBe('Named Pharmacy');
    });

    it('should handle rate limit error', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 429 },
        message: 'Too Many Requests',
      });
      mockedAxios.isAxiosError = vi.fn().mockReturnValue(true);

      await expect(
        osmService.searchPharmaciesNearby({
          latitude: 40.7,
          longitude: -74.0,
          radiusMeters: 5000,
        })
      ).rejects.toThrow('rate limit');
    });

    it('should handle timeout error', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 504 },
        message: 'Gateway Timeout',
      });
      mockedAxios.isAxiosError = vi.fn().mockReturnValue(true);

      await expect(
        osmService.searchPharmaciesNearby({
          latitude: 40.7,
          longitude: -74.0,
          radiusMeters: 50000, // Large radius
        })
      ).rejects.toThrow('timeout');
    });

    it('should handle generic API error', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));
      mockedAxios.isAxiosError = vi.fn().mockReturnValue(false);

      await expect(
        osmService.searchPharmaciesNearby({
          latitude: 40.7,
          longitude: -74.0,
          radiusMeters: 5000,
        })
      ).rejects.toThrow('Failed to search');
    });

    it('should filter by multiple chains', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 40.7,
              lon: -74.0,
              tags: { name: 'CVS Pharmacy' },
            },
            {
              type: 'node',
              id: 2,
              lat: 40.71,
              lon: -74.0,
              tags: { name: 'Walgreens' },
            },
            {
              type: 'node',
              id: 3,
              lat: 40.72,
              lon: -74.0,
              tags: { name: 'Rite Aid' },
            },
            {
              type: 'node',
              id: 4,
              lat: 40.73,
              lon: -74.0,
              tags: { name: 'Local Pharmacy' },
            },
          ],
        },
      });

      const result = await osmService.searchPharmaciesNearby({
        latitude: 40.7,
        longitude: -74.0,
        radiusMeters: 5000,
        chainFilter: ['CVS', 'WALGREENS'],
      });

      expect(result.pharmacies).toHaveLength(2);
      const names = result.pharmacies.map(p => p.name);
      expect(names).toContain('CVS Pharmacy');
      expect(names).toContain('Walgreens');
    });
  });

  describe('getPharmacyDetails', () => {
    it('should fetch pharmacy details by OSM ID', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [
            {
              type: 'node',
              id: 12345678,
              lat: 40.7128,
              lon: -74.006,
              tags: {
                name: 'CVS Pharmacy',
                phone: '+1-212-555-1234',
              },
            },
          ],
        },
      });

      const result = await osmService.getPharmacyDetails('osm:node:12345678');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('osm:node:12345678');
      expect(result?.name).toBe('CVS Pharmacy');
    });

    it('should return null for invalid ID format', async () => {
      const result = await osmService.getPharmacyDetails('invalid-id');
      expect(result).toBeNull();
    });

    it('should return null for non-existent element', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [],
        },
      });

      const result = await osmService.getPharmacyDetails('osm:node:99999999');
      expect(result).toBeNull();
    });

    it('should handle way type', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [
            {
              type: 'way',
              id: 87654321,
              center: { lat: 34.0522, lon: -118.2437 },
              tags: {
                name: 'Walgreens',
              },
            },
          ],
        },
      });

      const result = await osmService.getPharmacyDetails('osm:way:87654321');

      expect(result).not.toBeNull();
      expect(result?.osmType).toBe('way');
    });

    it('should handle API error', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      const result = await osmService.getPharmacyDetails('osm:node:12345678');
      expect(result).toBeNull();
    });
  });

  describe('chain filtering edge cases', () => {
    it('should match chain filter case-insensitively', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 40.7,
              lon: -74.0,
              tags: { name: 'cvs pharmacy' }, // lowercase
            },
          ],
        },
      });

      const result = await osmService.searchPharmaciesNearby({
        latitude: 40.7,
        longitude: -74.0,
        radiusMeters: 5000,
        chainFilter: ['CVS'], // uppercase
      });

      expect(result.pharmacies).toHaveLength(1);
    });

    it('should match by name when chain not detected from brand', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          version: 0.6,
          generator: 'Overpass API',
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 40.7,
              lon: -74.0,
              tags: {
                name: 'Rite Aid Store #123',
                // No brand tag
              },
            },
          ],
        },
      });

      const result = await osmService.searchPharmaciesNearby({
        latitude: 40.7,
        longitude: -74.0,
        radiusMeters: 5000,
        chainFilter: ['RITE_AID'],
      });

      expect(result.pharmacies).toHaveLength(1);
    });
  });
});
