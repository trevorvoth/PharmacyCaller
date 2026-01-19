import { cvsIVRPattern } from '../../config/ivrPatterns/cvs.js';
import { walgreensIVRPattern } from '../../config/ivrPatterns/walgreens.js';
import { riteAidIVRPattern } from '../../config/ivrPatterns/riteaid.js';
import type { PharmacyChain } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const ivrLogger = logger.child({ service: 'ivr-router' });

export interface IVRPattern {
  chain: string;
  patterns: Array<{
    prompt: RegExp;
    action: string;
    description: string;
  }>;
  holdMusic: string[];
  humanIndicators: RegExp[];
  estimatedHoldTime: number;
  tips: string[];
}

const IVR_PATTERNS: Record<string, IVRPattern> = {
  CVS: cvsIVRPattern,
  WALGREENS: walgreensIVRPattern,
  RITE_AID: riteAidIVRPattern,
};

const DEFAULT_PATTERN: IVRPattern = {
  chain: 'GENERIC',
  patterns: [
    {
      prompt: /pharmacy/i,
      action: 'press 1',
      description: 'Try pharmacy option',
    },
    {
      prompt: /operator|representative/i,
      action: 'press 0',
      description: 'Request operator',
    },
  ],
  holdMusic: ['hold', 'please wait', 'your call'],
  humanIndicators: [
    /how can I help/i,
    /how may I assist/i,
    /speaking/i,
    /hello/i,
  ],
  estimatedHoldTime: 300,
  tips: [
    'Try pressing 0 for operator if unsure',
    'Listen for all menu options before acting',
  ],
};

// Phone number patterns for chain detection
const PHONE_PATTERNS: Array<{ pattern: RegExp; chain: PharmacyChain }> = [
  { pattern: /CVS/i, chain: 'CVS' },
  { pattern: /Walgreens/i, chain: 'WALGREENS' },
  { pattern: /Rite\s*Aid/i, chain: 'RITE_AID' },
  { pattern: /Walmart/i, chain: 'WALMART' },
  { pattern: /Costco/i, chain: 'COSTCO' },
  { pattern: /Kroger/i, chain: 'KROGER' },
  { pattern: /Publix/i, chain: 'PUBLIX' },
  { pattern: /H-?E-?B/i, chain: 'HEB' },
  { pattern: /Safeway/i, chain: 'SAFEWAY' },
];

export const ivrRouter = {
  detectChain(pharmacyName: string, phoneNumber?: string): PharmacyChain | null {
    // Check name first
    for (const { pattern, chain } of PHONE_PATTERNS) {
      if (pattern.test(pharmacyName)) {
        ivrLogger.debug({ pharmacyName, chain }, 'Chain detected from name');
        return chain;
      }
    }

    // Could also check phone number area codes or known numbers
    // For now, return null for unknown chains

    ivrLogger.debug({ pharmacyName }, 'No chain detected');
    return null;
  },

  getPattern(chain: PharmacyChain | null): IVRPattern {
    if (chain && IVR_PATTERNS[chain]) {
      return IVR_PATTERNS[chain]!;
    }
    return DEFAULT_PATTERN;
  },

  getInstructions(pharmacyName: string, chain: PharmacyChain | null): string {
    const pattern = this.getPattern(chain);

    let instructions = `## IVR Navigation for ${chain ?? 'Unknown'} Pharmacy\n\n`;

    instructions += '### Menu Navigation\n';
    for (const p of pattern.patterns) {
      instructions += `- When you hear "${p.description}": ${p.action}\n`;
    }

    instructions += '\n### Tips\n';
    for (const tip of pattern.tips) {
      instructions += `- ${tip}\n`;
    }

    instructions += `\n### Expected Hold Time\n`;
    instructions += `Approximately ${Math.round(pattern.estimatedHoldTime / 60)} minutes\n`;

    return instructions;
  },

  isHumanSpeaking(text: string, chain: PharmacyChain | null): boolean {
    const pattern = this.getPattern(chain);

    for (const indicator of pattern.humanIndicators) {
      if (indicator.test(text)) {
        ivrLogger.info({ text, chain, indicator: indicator.toString() }, 'Human detected');
        return true;
      }
    }

    return false;
  },

  isOnHold(text: string, chain: PharmacyChain | null): boolean {
    const pattern = this.getPattern(chain);

    for (const music of pattern.holdMusic) {
      if (text.toLowerCase().includes(music.toLowerCase())) {
        return true;
      }
    }

    // Common hold indicators
    const holdIndicators = [
      /please hold/i,
      /your call is important/i,
      /next available/i,
      /estimated wait/i,
      /\(music\)/i,
      /\(hold music\)/i,
    ];

    for (const indicator of holdIndicators) {
      if (indicator.test(text)) {
        return true;
      }
    }

    return false;
  },

  suggestAction(prompt: string, chain: PharmacyChain | null): string | null {
    const pattern = this.getPattern(chain);

    for (const p of pattern.patterns) {
      if (p.prompt.test(prompt)) {
        ivrLogger.debug({ prompt, action: p.action }, 'Action suggested');
        return p.action;
      }
    }

    return null;
  },
};
