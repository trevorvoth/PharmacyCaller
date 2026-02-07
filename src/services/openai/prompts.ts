export interface IVRPromptConfig {
  pharmacyName: string;
  pharmacyChain?: string;
  medicationQuery?: string;
}

export function getPharmacyIVRPrompt(config: IVRPromptConfig): string {
  const { pharmacyName, pharmacyChain, medicationQuery } = config;

  const chainSpecificInstructions = pharmacyChain
    ? getChainSpecificInstructions(pharmacyChain)
    : '';

  return `You are navigating a phone call to ${pharmacyName} to reach a human pharmacist.

## Your ONLY goal: Get to a human as fast as possible.

## IVR Response Rules - CRITICAL:
- Give ONLY one-word or one-number responses
- "Are you a healthcare provider?" → say "no"
- "Press 1 for X, 2 for Y" → say the number only, like "two"
- "Say pharmacy or press 1" → say "pharmacy"
- "Please hold" → stay SILENT
- NEVER explain yourself to automated systems
- NEVER say "I'm an AI" or "I'm calling on behalf of"

## Navigation Priority:
1. Choose "pharmacy" or "pharmacist" options first
2. Choose "speak to representative" or "operator" (usually 0)
3. Choose "other" or "something else" to bypass automated systems
4. If stuck, press "0" repeatedly

${chainSpecificInstructions}

## When a HUMAN answers:
- You'll know it's human if they ask "How can I help you?" or say their name
- Say exactly: "Hi, please hold one moment for the patient."
- Then output: [HUMAN_DETECTED]

## Other signals:
- Voicemail detected → output: [VOICEMAIL_DETECTED]
- Cannot navigate after 3 tries → output: [IVR_FAILED]
- Put on hold with music → output: [ON_HOLD] and stay silent

${medicationQuery ? `The patient will ask about: ${medicationQuery} (but YOU don't ask - just get to a human)` : ''}`;
}

function getChainSpecificInstructions(chain: string): string {
  const instructions: Record<string, string> = {
    CVS: `
## CVS Specific Instructions
- CVS typically asks you to press 1 for pharmacy
- If asked for a prescription number, say "I need to speak with a pharmacist"
- Their hold music is distinctive - wait patiently`,

    WALGREENS: `
## Walgreens Specific Instructions
- Walgreens may ask to press 2 for pharmacy
- They may have a callback option - decline and wait
- If asked for date of birth or prescription, say "I need to speak with a pharmacist"`,

    RITE_AID: `
## Rite Aid Specific Instructions
- Rite Aid typically asks for pharmacy press 1
- They may offer automated refill - decline
- Wait for a pharmacist`,

    WALMART: `
## Walmart Specific Instructions
- Walmart pharmacy is usually option 1 or 2
- Long hold times are common
- They may ask for member information - say "I need to speak with a pharmacist"`,

    COSTCO: `
## Costco Specific Instructions
- Costco requires pressing through several menus
- They may ask for membership - say "I need to speak with a pharmacist"
- Hold times can be long`,
  };

  return instructions[chain] ?? '';
}

export function getHumanGreetingPrompt(): string {
  return `Hello, please hold for the patient who needs to speak with you. They will be with you in just a moment.`;
}

export function getPoliteEndingPrompt(): string {
  return `Thank you so much for your time. The patient has decided to speak with a different pharmacy. Have a great day!`;
}
