import { describe, it, expect } from 'vitest';
import {
  detectChain,
  detectChainFromBrand,
  calculateDistance,
  extractCityState,
  assembleAddressFromOSM,
  formatPhoneNumber,
  isValidPhoneNumber,
  metersToMiles,
  milesToMeters,
} from '../../src/services/pharmacyHelpers.js';

describe('Pharmacy Helpers', () => {
  describe('detectChain', () => {
    it('should detect CVS from name', () => {
      expect(detectChain('CVS Pharmacy')).toBe('CVS');
      expect(detectChain('CVS Pharmacy #1234')).toBe('CVS');
      expect(detectChain('cvs pharmacy')).toBe('CVS');
    });

    it('should detect Walgreens from name', () => {
      expect(detectChain('Walgreens')).toBe('WALGREENS');
      expect(detectChain('Walgreens Pharmacy')).toBe('WALGREENS');
      expect(detectChain('WALGREENS #5678')).toBe('WALGREENS');
    });

    it('should detect Rite Aid from name', () => {
      expect(detectChain('Rite Aid')).toBe('RITE_AID');
      expect(detectChain('Rite Aid Pharmacy')).toBe('RITE_AID');
      expect(detectChain('RiteAid')).toBe('RITE_AID'); // Also handles without space
    });

    it('should detect Walmart from name', () => {
      expect(detectChain('Walmart Pharmacy')).toBe('WALMART');
      expect(detectChain('Walmart Supercenter Pharmacy')).toBe('WALMART');
    });

    it('should detect Costco from name', () => {
      expect(detectChain('Costco Pharmacy')).toBe('COSTCO');
      expect(detectChain('Costco Wholesale Pharmacy')).toBe('COSTCO');
    });

    it('should detect Kroger from name', () => {
      expect(detectChain('Kroger Pharmacy')).toBe('KROGER');
      expect(detectChain('Kroger')).toBe('KROGER');
    });

    it('should detect Publix from name', () => {
      expect(detectChain('Publix Pharmacy')).toBe('PUBLIX');
      expect(detectChain('Publix Super Markets Pharmacy')).toBe('PUBLIX');
    });

    it('should detect HEB from name', () => {
      expect(detectChain('H-E-B Pharmacy')).toBe('HEB');
      expect(detectChain('HEB Pharmacy')).toBe('HEB');
      // Note: "H E B" with spaces doesn't match - hyphenated or concatenated only
    });

    it('should detect Safeway from name', () => {
      expect(detectChain('Safeway Pharmacy')).toBe('SAFEWAY');
      expect(detectChain('Safeway')).toBe('SAFEWAY');
    });

    it('should return null for independent pharmacies', () => {
      expect(detectChain('Local Community Pharmacy')).toBeNull();
      expect(detectChain("John's Drug Store")).toBeNull();
      expect(detectChain('Main Street Pharmacy')).toBeNull();
    });

    it('should not false-positive on partial matches', () => {
      // "CVS" shouldn't match "canvas" or similar
      expect(detectChain('Canvas Art Store')).toBeNull();
    });
  });

  describe('detectChainFromBrand', () => {
    it('should detect chain from OSM brand tag', () => {
      expect(detectChainFromBrand('CVS Pharmacy', 'Store Name')).toBe('CVS');
      expect(detectChainFromBrand('Walgreens', 'Some Pharmacy')).toBe('WALGREENS');
      expect(detectChainFromBrand('H-E-B', 'Any Name')).toBe('HEB');
    });

    it('should fall back to name detection when brand not in map', () => {
      expect(detectChainFromBrand('Unknown Brand', 'CVS Pharmacy')).toBe('CVS');
      expect(detectChainFromBrand(undefined, 'Walgreens Store')).toBe('WALGREENS');
    });

    it('should return null when neither brand nor name matches', () => {
      expect(detectChainFromBrand('Local Brand', 'Local Pharmacy')).toBeNull();
      expect(detectChainFromBrand(undefined, 'Community Drug')).toBeNull();
    });
  });

  describe('calculateDistance', () => {
    it('should return 0 for same coordinates', () => {
      const distance = calculateDistance(40.7128, -74.006, 40.7128, -74.006);
      expect(distance).toBe(0);
    });

    it('should calculate distance between NYC and LA (~3940 km)', () => {
      // NYC: 40.7128, -74.0060
      // LA: 34.0522, -118.2437
      const distance = calculateDistance(40.7128, -74.006, 34.0522, -118.2437);
      // Should be approximately 3940 km (3,940,000 meters)
      expect(distance).toBeGreaterThan(3900000);
      expect(distance).toBeLessThan(4000000);
    });

    it('should calculate short distances accurately', () => {
      // Two points about 1 km apart
      const distance = calculateDistance(40.7128, -74.006, 40.7218, -74.006);
      // Should be approximately 1000 meters (0.009 degrees latitude ~ 1km)
      expect(distance).toBeGreaterThan(900);
      expect(distance).toBeLessThan(1100);
    });

    it('should be symmetric', () => {
      const d1 = calculateDistance(40.7128, -74.006, 34.0522, -118.2437);
      const d2 = calculateDistance(34.0522, -118.2437, 40.7128, -74.006);
      expect(d1).toBeCloseTo(d2, 5);
    });

    it('should handle coordinates near the poles', () => {
      // Near North Pole
      const distance = calculateDistance(89.0, 0, 89.0, 180);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(500000); // Less than 500km
    });

    it('should handle coordinates crossing the meridian', () => {
      const distance = calculateDistance(51.5074, -0.1278, 51.5074, 0.1278);
      expect(distance).toBeGreaterThan(0);
    });
  });

  describe('extractCityState', () => {
    it('should extract from standard US address format', () => {
      const result = extractCityState('123 Main St, Los Angeles, CA 90001, USA');
      expect(result.city).toBe('Los Angeles');
      expect(result.state).toBe('CA');
    });

    it('should handle different city names', () => {
      expect(extractCityState('456 Oak Ave, New York, NY 10001, USA')).toEqual({
        city: 'New York',
        state: 'NY',
      });

      expect(extractCityState('789 Pine St, San Francisco, CA 94102, USA')).toEqual({
        city: 'San Francisco',
        state: 'CA',
      });
    });

    it('should handle addresses without USA suffix', () => {
      const result = extractCityState('100 Broadway, Chicago, IL 60601');
      expect(result.city).toBe('Chicago');
      expect(result.state).toBe('IL');
    });

    it('should handle multi-word city names', () => {
      const result = extractCityState('555 Main St, Salt Lake City, UT 84101, USA');
      expect(result.city).toBe('Salt Lake City');
      expect(result.state).toBe('UT');
    });

    it('should use fallback parsing for non-standard formats', () => {
      const result = extractCityState('123 Main, Boston, MA 02101');
      expect(result.city).toBe('Boston');
      expect(result.state).toBe('MA');
    });

    it('should return empty strings for unparseable addresses', () => {
      const result = extractCityState('Unknown Location');
      expect(result.city).toBe('');
      expect(result.state).toBe('');
    });

    it('should handle addresses with suite numbers', () => {
      const result = extractCityState('123 Main St Suite 100, Denver, CO 80202, USA');
      expect(result.city).toBe('Denver');
      expect(result.state).toBe('CO');
    });
  });

  describe('assembleAddressFromOSM', () => {
    it('should assemble full address from all components', () => {
      const tags = {
        'addr:housenumber': '123',
        'addr:street': 'Main Street',
        'addr:city': 'Springfield',
        'addr:state': 'IL',
        'addr:postcode': '62701',
      };
      const result = assembleAddressFromOSM(tags);
      expect(result).toBe('123 Main Street, Springfield, IL 62701');
    });

    it('should handle missing house number', () => {
      const tags = {
        'addr:street': 'Oak Avenue',
        'addr:city': 'Portland',
        'addr:state': 'OR',
        'addr:postcode': '97201',
      };
      const result = assembleAddressFromOSM(tags);
      expect(result).toBe('Oak Avenue, Portland, OR 97201');
    });

    it('should handle missing city', () => {
      const tags = {
        'addr:housenumber': '456',
        'addr:street': 'Pine Road',
        'addr:state': 'WA',
        'addr:postcode': '98101',
      };
      const result = assembleAddressFromOSM(tags);
      expect(result).toBe('456 Pine Road, WA 98101');
    });

    it('should handle missing postcode', () => {
      const tags = {
        'addr:housenumber': '789',
        'addr:street': 'Elm Street',
        'addr:city': 'Seattle',
        'addr:state': 'WA',
      };
      const result = assembleAddressFromOSM(tags);
      expect(result).toBe('789 Elm Street, Seattle, WA');
    });

    it('should handle minimal address info', () => {
      const tags = {
        'addr:city': 'Austin',
        'addr:state': 'TX',
      };
      const result = assembleAddressFromOSM(tags);
      expect(result).toBe('Austin, TX');
    });

    it('should handle empty tags', () => {
      const result = assembleAddressFromOSM({});
      expect(result).toBe('');
    });
  });

  describe('formatPhoneNumber', () => {
    it('should format 10-digit number to E.164', () => {
      expect(formatPhoneNumber('2135551234')).toBe('+12135551234');
    });

    it('should format 11-digit number starting with 1', () => {
      expect(formatPhoneNumber('12135551234')).toBe('+12135551234');
    });

    it('should handle formatted phone numbers', () => {
      expect(formatPhoneNumber('(213) 555-1234')).toBe('+12135551234');
      expect(formatPhoneNumber('213-555-1234')).toBe('+12135551234');
      expect(formatPhoneNumber('213.555.1234')).toBe('+12135551234');
    });

    it('should handle phone with country code prefix', () => {
      expect(formatPhoneNumber('1-213-555-1234')).toBe('+12135551234');
      expect(formatPhoneNumber('+1 213 555 1234')).toBe('+12135551234');
    });

    it('should return original for non-standard formats', () => {
      expect(formatPhoneNumber('123')).toBe('123');
      expect(formatPhoneNumber('invalid')).toBe('invalid');
    });
  });

  describe('isValidPhoneNumber', () => {
    it('should return true for valid 10-digit numbers', () => {
      expect(isValidPhoneNumber('2135551234')).toBe(true);
      expect(isValidPhoneNumber('(213) 555-1234')).toBe(true);
      expect(isValidPhoneNumber('213-555-1234')).toBe(true);
    });

    it('should return true for valid 11-digit numbers starting with 1', () => {
      expect(isValidPhoneNumber('12135551234')).toBe(true);
      expect(isValidPhoneNumber('1-213-555-1234')).toBe(true);
      expect(isValidPhoneNumber('+12135551234')).toBe(true);
    });

    it('should return false for invalid numbers', () => {
      expect(isValidPhoneNumber('123')).toBe(false);
      expect(isValidPhoneNumber('12345678901234')).toBe(false);
      expect(isValidPhoneNumber('')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isValidPhoneNumber(null)).toBe(false);
      expect(isValidPhoneNumber(undefined)).toBe(false);
    });
  });

  describe('metersToMiles', () => {
    it('should convert meters to miles', () => {
      expect(metersToMiles(1609.344)).toBeCloseTo(1, 5);
      expect(metersToMiles(8046.72)).toBeCloseTo(5, 5);
      expect(metersToMiles(0)).toBe(0);
    });
  });

  describe('milesToMeters', () => {
    it('should convert miles to meters', () => {
      expect(milesToMeters(1)).toBeCloseTo(1609.344, 3);
      expect(milesToMeters(5)).toBeCloseTo(8046.72, 2);
      expect(milesToMeters(0)).toBe(0);
    });
  });

  describe('distance and conversion round-trip', () => {
    it('should round-trip meters to miles and back', () => {
      const original = 5000;
      const miles = metersToMiles(original);
      const backToMeters = milesToMeters(miles);
      expect(backToMeters).toBeCloseTo(original, 5);
    });
  });
});
