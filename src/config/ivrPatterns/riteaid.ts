export const riteAidIVRPattern = {
  chain: 'RITE_AID',
  patterns: [
    {
      prompt: /pharmacy|prescription/i,
      action: 'press 1',
      description: 'Pharmacy department',
    },
    {
      prompt: /automated refill|refill.*prescription/i,
      action: 'press 0',
      description: 'Skip automated refill',
    },
    {
      prompt: /speak.*representative|operator/i,
      action: 'press 0',
      description: 'Request operator',
    },
    {
      prompt: /prescription number/i,
      action: 'say "I need to speak with a pharmacist"',
      description: 'Skip prescription lookup',
    },
  ],
  holdMusic: ['Rite Aid', 'pharmacy', 'please hold'],
  humanIndicators: [
    /Rite Aid pharmacy/i,
    /how can I assist/i,
    /speaking/i,
    /hello.*pharmacy/i,
  ],
  estimatedHoldTime: 240, // 4 minutes typical
  tips: [
    'Rite Aid typically has pharmacy as option 1',
    'May offer automated refill - skip it',
    'Generally shorter hold times than competitors',
  ],
};
