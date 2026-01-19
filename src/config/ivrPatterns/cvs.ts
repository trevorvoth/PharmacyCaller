export const cvsIVRPattern = {
  chain: 'CVS',
  patterns: [
    {
      prompt: /pharmacy|prescription|refill/i,
      action: 'press 1',
      description: 'Main pharmacy menu',
    },
    {
      prompt: /speak.*pharmacist|talk.*pharmacist/i,
      action: 'press 0',
      description: 'Request to speak with pharmacist',
    },
    {
      prompt: /prescription number/i,
      action: 'say "I need to speak with a pharmacist"',
      description: 'Skip prescription lookup',
    },
    {
      prompt: /date of birth/i,
      action: 'say "I need to speak with a pharmacist"',
      description: 'Skip DOB verification',
    },
  ],
  holdMusic: ['CVS', 'pharmacy', 'hold'],
  humanIndicators: [
    /how can I help/i,
    /pharmacy.*speaking/i,
    /what can I do for you/i,
    /hi.*this is/i,
  ],
  estimatedHoldTime: 300, // 5 minutes typical
  tips: [
    'CVS typically routes pharmacy calls to press 1',
    'If asked for prescription info, request a pharmacist',
    'Hold times average 3-7 minutes',
  ],
};
