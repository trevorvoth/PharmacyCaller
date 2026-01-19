export const walgreensIVRPattern = {
  chain: 'WALGREENS',
  patterns: [
    {
      prompt: /pharmacy|prescription/i,
      action: 'press 2',
      description: 'Pharmacy department',
    },
    {
      prompt: /refill|pick up/i,
      action: 'press 0',
      description: 'Skip automated refill, get operator',
    },
    {
      prompt: /callback|call.*back/i,
      action: 'say "No thank you, I will hold"',
      description: 'Decline callback option',
    },
    {
      prompt: /prescription number|rx number/i,
      action: 'say "I need to speak with a pharmacist"',
      description: 'Skip prescription lookup',
    },
    {
      prompt: /date of birth|verify/i,
      action: 'say "I need to speak with a pharmacist"',
      description: 'Skip verification',
    },
  ],
  holdMusic: ['Walgreens', 'pharmacy', 'your call is important'],
  humanIndicators: [
    /Walgreens pharmacy/i,
    /how may I help/i,
    /pharmacist speaking/i,
    /this is.*pharmacy/i,
  ],
  estimatedHoldTime: 420, // 7 minutes typical
  tips: [
    'Walgreens may offer callback - decline to wait',
    'Pharmacy is typically option 2',
    'They may have longer hold times',
  ],
};
