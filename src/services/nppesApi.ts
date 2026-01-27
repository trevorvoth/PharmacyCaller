import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

const NPPES_API_BASE = 'https://npiregistry.cms.hhs.gov/api/';
const NPPES_API_VERSION = '2.1';
const PHARMACY_TAXONOMY = 'Pharmacy';

// NPPES debug log file path
const NPPES_LOG_DIR = path.join(process.cwd(), 'logs');
const NPPES_LOG_FILE = path.join(NPPES_LOG_DIR, 'nppes-debug.log');

/**
 * Append NPPES data to debug log file for review
 */
function logToFile(data: Record<string, unknown>): void {
  try {
    // Ensure log directory exists
    if (!fs.existsSync(NPPES_LOG_DIR)) {
      fs.mkdirSync(NPPES_LOG_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const logEntry = JSON.stringify({ timestamp, ...data }, null, 2) + '\n---\n';
    fs.appendFileSync(NPPES_LOG_FILE, logEntry);
  } catch (err) {
    logger.warn({ err }, 'Failed to write to NPPES log file');
  }
}

export interface NppesAddress {
  address_1: string;
  address_2?: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  telephone_number?: string;
  fax_number?: string;
  address_purpose: 'LOCATION' | 'MAILING';
}

export interface NppesResult {
  number: string; // NPI number
  basic: {
    organization_name?: string;
    first_name?: string;
    last_name?: string;
    status: string;
    enumeration_date: string;
    last_updated: string;
  };
  addresses: NppesAddress[];
  taxonomies: Array<{
    code: string;
    desc: string;
    primary: boolean;
    state?: string;
  }>;
}

export interface NppesSearchResponse {
  result_count: number;
  results: NppesResult[];
}

export interface PharmacyPhoneLookupRequest {
  organizationName: string;
  city: string;
  state: string;
}

export interface PharmacyPhoneLookupResult {
  npi: string;
  organizationName: string;
  telephoneNumber: string | null;
  faxNumber: string | null;
  address: string;
  city: string;
  state: string;
  matchScore: number; // 0-100 confidence in match
}

/**
 * Calculate a simple match score between two pharmacy names
 * Returns 0-100 where 100 is exact match
 */
function calculateNameMatchScore(name1: string, name2: string): number {
  const normalize = (s: string): string =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const n1 = normalize(name1);
  const n2 = normalize(name2);

  // Exact match
  if (n1 === n2) {
    return 100;
  }

  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) {
    return 80;
  }

  // Word overlap
  const words1 = n1.split(' ');
  const words2 = n2.split(' ');
  const words2Set = new Set(words2);
  const commonWords = words1.filter(w => words2Set.has(w) && w.length > 2);
  const totalWords = Math.max(words1.length, words2.length);

  if (totalWords === 0) {
    return 0;
  }

  const overlapScore = (commonWords.length / totalWords) * 70;
  return Math.round(overlapScore);
}

/**
 * Extract the best phone number from NPPES addresses
 * Prefers LOCATION address over MAILING
 */
function extractPhoneFromAddresses(addresses: NppesAddress[]): { phone: string | null; fax: string | null } {
  // First try to find a LOCATION address with phone
  const locationAddr = addresses.find(a => a.address_purpose === 'LOCATION' && a.telephone_number);
  if (locationAddr?.telephone_number) {
    return {
      phone: formatPhoneNumber(locationAddr.telephone_number),
      fax: locationAddr.fax_number ? formatPhoneNumber(locationAddr.fax_number) : null,
    };
  }

  // Fall back to any address with phone
  const anyAddr = addresses.find(a => a.telephone_number);
  if (anyAddr?.telephone_number) {
    return {
      phone: formatPhoneNumber(anyAddr.telephone_number),
      fax: anyAddr.fax_number ? formatPhoneNumber(anyAddr.fax_number) : null,
    };
  }

  return { phone: null, fax: null };
}

/**
 * Format phone number to E.164 format (+1XXXXXXXXXX)
 */
function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Return original if can't format
  return phone;
}

export const nppesApiService = {
  /**
   * Search NPPES for a pharmacy by name and location
   */
  async searchPharmacy(request: PharmacyPhoneLookupRequest): Promise<PharmacyPhoneLookupResult | null> {
    const { organizationName, city, state } = request;

    logger.debug({
      organizationName,
      city,
      state,
    }, 'Searching NPPES for pharmacy');

    // Log search request to file
    logToFile({
      action: 'search_request',
      organizationName,
      city,
      state,
    });

    try {
      const response = await axios.get<NppesSearchResponse>(NPPES_API_BASE, {
        params: {
          version: NPPES_API_VERSION,
          taxonomy_description: PHARMACY_TAXONOMY,
          organization_name: organizationName,
          city: city,
          state: state,
          limit: 5, // Get top 5 matches to find best
        },
        timeout: 5000, // 5 second timeout
      });

      if (!response.data.results || response.data.results.length === 0) {
        logger.info({ organizationName, city, state }, 'No NPPES results found');
        logToFile({
          action: 'search_result',
          organizationName,
          city,
          state,
          resultCount: 0,
          match: null,
          reason: 'no_results_from_api',
        });
        return null;
      }

      // Find best match by name similarity
      let bestMatch: NppesResult | null = null;
      let bestScore = 0;

      for (const result of response.data.results) {
        const resultName = result.basic.organization_name ?? '';
        const score = calculateNameMatchScore(organizationName, resultName);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = result;
        }
      }

      // Require minimum 50% match score
      if (!bestMatch || bestScore < 50) {
        // Collect all candidate names for debugging
        const candidateNames = response.data.results.map(r => ({
          name: r.basic.organization_name ?? '(unnamed)',
          score: calculateNameMatchScore(organizationName, r.basic.organization_name ?? ''),
        }));

        logger.info({
          organizationName,
          bestScore,
          resultsCount: response.data.results.length,
          candidateNames: candidateNames.slice(0, 3), // Log top 3 candidates
        }, 'No good NPPES match found - score below 50% threshold');

        logToFile({
          action: 'search_result',
          organizationName,
          city,
          state,
          resultCount: response.data.results.length,
          bestScore,
          bestMatchName: bestMatch?.basic.organization_name ?? null,
          candidateNames,
          match: null,
          reason: 'match_score_below_threshold',
        });
        return null;
      }

      // Extract phone from addresses
      const { phone, fax } = extractPhoneFromAddresses(bestMatch.addresses);

      // Get location address for return
      const locationAddr = bestMatch.addresses.find(a => a.address_purpose === 'LOCATION')
        ?? bestMatch.addresses[0];

      const result: PharmacyPhoneLookupResult = {
        npi: bestMatch.number,
        organizationName: bestMatch.basic.organization_name ?? organizationName,
        telephoneNumber: phone,
        faxNumber: fax,
        address: locationAddr?.address_1 ?? '',
        city: locationAddr?.city ?? city,
        state: locationAddr?.state ?? state,
        matchScore: bestScore,
      };

      // Log with more detail about phone availability
      if (!phone) {
        logger.info({
          searchName: organizationName,
          matchedName: result.organizationName,
          matchScore: bestScore,
          hasPhone: false,
          addressCount: bestMatch.addresses.length,
          addressTypes: bestMatch.addresses.map(a => a.address_purpose),
        }, 'NPPES match found but NO phone number in registry');
      } else {
        logger.info({
          searchName: organizationName,
          matchedName: result.organizationName,
          matchScore: bestScore,
          hasPhone: true,
        }, 'NPPES pharmacy match found with phone');
      }

      // Log match to file with phone availability details
      logToFile({
        action: 'search_result',
        organizationName,
        city,
        state,
        resultCount: response.data.results.length,
        match: {
          npi: result.npi,
          matchedName: result.organizationName,
          matchScore: bestScore,
          phone: result.telephoneNumber,
          fax: result.faxNumber,
          address: result.address,
          hasPhone: !!phone,
          addressCount: bestMatch.addresses.length,
          addressTypes: bestMatch.addresses.map(a => a.address_purpose),
        },
      });

      return result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error({
          status: error.response?.status,
          message: error.message,
          organizationName,
        }, 'NPPES API error');
        logToFile({
          action: 'search_error',
          organizationName,
          city,
          state,
          error: {
            type: 'axios',
            status: error.response?.status,
            message: error.message,
          },
        });
      } else {
        logger.error({ err: error, organizationName }, 'NPPES lookup failed');
        logToFile({
          action: 'search_error',
          organizationName,
          city,
          state,
          error: {
            type: 'unknown',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      return null;
    }
  },

  /**
   * Batch lookup phone numbers for multiple pharmacies
   * Returns a map of pharmacy name -> phone number
   */
  async batchLookupPhones(
    pharmacies: Array<{ name: string; city: string; state: string }>
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    // Process in parallel with concurrency limit
    const CONCURRENCY = 3;
    const chunks: Array<Array<{ name: string; city: string; state: string }>> = [];

    for (let i = 0; i < pharmacies.length; i += CONCURRENCY) {
      chunks.push(pharmacies.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      const lookups = chunk.map(async (pharmacy) => {
        const result = await this.searchPharmacy({
          organizationName: pharmacy.name,
          city: pharmacy.city,
          state: pharmacy.state,
        });

        if (result?.telephoneNumber) {
          results.set(pharmacy.name, result.telephoneNumber);
        }
      });

      await Promise.all(lookups);
    }

    logger.info({
      requested: pharmacies.length,
      found: results.size,
    }, 'NPPES batch lookup complete');

    // Log batch summary to file
    logToFile({
      action: 'batch_complete',
      requested: pharmacies.length,
      found: results.size,
      pharmaciesWithPhones: Array.from(results.entries()).map(([name, phone]) => ({
        name,
        phone,
      })),
    });

    return results;
  },
};
