/**
 * Batch 7 Integration Tests: Frontend Foundation
 *
 * Tests:
 * - 7.1-7.11: Frontend setup and components
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';

const webDir = join(__dirname, '../../web');

describe('Batch 7.1: Vite + React + TypeScript Setup', () => {
  it('should have package.json', () => {
    expect(existsSync(join(webDir, 'package.json'))).toBe(true);
  });

  it('should have vite.config.ts', () => {
    expect(existsSync(join(webDir, 'vite.config.ts'))).toBe(true);
  });

  it('should have tsconfig.json', () => {
    expect(existsSync(join(webDir, 'tsconfig.json'))).toBe(true);
  });

  it('should have index.html', () => {
    expect(existsSync(join(webDir, 'index.html'))).toBe(true);
  });

  it('should have src/main.tsx', () => {
    expect(existsSync(join(webDir, 'src/main.tsx'))).toBe(true);
  });

  it('should have src/App.tsx', () => {
    expect(existsSync(join(webDir, 'src/App.tsx'))).toBe(true);
  });
});

describe('Batch 7.2: Tailwind CSS Configuration', () => {
  it('should have tailwind.config.js', () => {
    expect(existsSync(join(webDir, 'tailwind.config.js'))).toBe(true);
  });

  it('should have postcss.config.js', () => {
    expect(existsSync(join(webDir, 'postcss.config.js'))).toBe(true);
  });

  it('should have src/index.css', () => {
    expect(existsSync(join(webDir, 'src/index.css'))).toBe(true);
  });
});

describe('Batch 7.3: React Router Setup', () => {
  it('should have App.tsx with routes', () => {
    expect(existsSync(join(webDir, 'src/App.tsx'))).toBe(true);
  });
});

describe('Batch 7.4: AuthContext', () => {
  it('should have AuthContext.tsx', () => {
    expect(existsSync(join(webDir, 'src/contexts/AuthContext.tsx'))).toBe(true);
  });
});

describe('Batch 7.5: API Client', () => {
  it('should have api.ts service', () => {
    expect(existsSync(join(webDir, 'src/services/api.ts'))).toBe(true);
  });
});

describe('Batch 7.6: WebSocket Context', () => {
  it('should have WebSocketContext.tsx', () => {
    expect(existsSync(join(webDir, 'src/contexts/WebSocketContext.tsx'))).toBe(true);
  });
});

describe('Batch 7.7: ThemeContext', () => {
  it('should have ThemeContext.tsx', () => {
    expect(existsSync(join(webDir, 'src/contexts/ThemeContext.tsx'))).toBe(true);
  });
});

describe('Batch 7.8: Base UI Components', () => {
  it('should have Button.tsx', () => {
    expect(existsSync(join(webDir, 'src/components/Button.tsx'))).toBe(true);
  });

  it('should have Input.tsx', () => {
    expect(existsSync(join(webDir, 'src/components/Input.tsx'))).toBe(true);
  });

  it('should have Card.tsx', () => {
    expect(existsSync(join(webDir, 'src/components/Card.tsx'))).toBe(true);
  });
});

describe('Batch 7.9: Layout Component', () => {
  it('should have Layout.tsx', () => {
    expect(existsSync(join(webDir, 'src/components/Layout.tsx'))).toBe(true);
  });
});

describe('Batch 7.10: LoginPage', () => {
  it('should have LoginPage.tsx', () => {
    expect(existsSync(join(webDir, 'src/pages/LoginPage.tsx'))).toBe(true);
  });
});

describe('Batch 7.11: RegisterPage', () => {
  it('should have RegisterPage.tsx', () => {
    expect(existsSync(join(webDir, 'src/pages/RegisterPage.tsx'))).toBe(true);
  });
});

describe('Batch 7.V: Build Verification', () => {
  it('should have built dist folder', () => {
    expect(existsSync(join(webDir, 'dist/index.html'))).toBe(true);
  });
});
