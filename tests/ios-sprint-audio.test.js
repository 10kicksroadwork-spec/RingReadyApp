import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

function createMockAudioContext(initialState = 'suspended') {
  const ctx = {
    state: initialState,
    currentTime: 0,
    sampleRate: 22050,
    destination: {},
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    createOscillator: vi.fn(() => ({
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
    createGain: vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    })),
    createBuffer: vi.fn(() => ({})),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
    })),
  };
  return ctx;
}

describe('iOS sprint audio recovery', () => {
  let unlockAudio;
  let beep;
  let getAudioContextState;
  let recoverAudioAfterBackground;
  let MockAudioContext;
  let created;

  beforeEach(async () => {
    vi.resetModules();
    created = [];
    MockAudioContext = vi.fn(function MockAudioContext(initial) {
      const ctx = createMockAudioContext(typeof initial === 'string' ? initial : 'suspended');
      created.push(ctx);
      return ctx;
    });
    window.AudioContext = MockAudioContext;
    window.webkitAudioContext = MockAudioContext;

    const ui = await import('../src/ui.js');
    unlockAudio = ui.unlockAudio;
    beep = ui.beep;
    getAudioContextState = ui.getAudioContextState;
    recoverAudioAfterBackground = ui.recoverAudioAfterBackground;
  });

  afterEach(() => {
    delete window.AudioContext;
    delete window.webkitAudioContext;
    vi.restoreAllMocks();
  });

  it('reports none before any unlock', () => {
    expect(getAudioContextState()).toBe('none');
  });

  it('awaits resume from suspended and returns running', async () => {
    const ok = await unlockAudio('test');
    expect(ok).toBe(true);
    expect(MockAudioContext).toHaveBeenCalledTimes(1);
    expect(created[0].resume).toHaveBeenCalledTimes(1);
    expect(getAudioContextState()).toBe('running');
    expect(created[0].createBufferSource).toHaveBeenCalled();
  });

  it('resumes interrupted (legacy iOS) contexts', async () => {
    MockAudioContext.mockImplementationOnce(() => {
      const ctx = createMockAudioContext('interrupted');
      created.push(ctx);
      return ctx;
    });

    const ok = await unlockAudio('interrupted');
    expect(ok).toBe(true);
    expect(created[0].resume).toHaveBeenCalledTimes(1);
    expect(getAudioContextState()).toBe('running');
  });

  it('recreates context when resume throws', async () => {
    let call = 0;
    MockAudioContext.mockImplementation(() => {
      call += 1;
      const ctx = createMockAudioContext('suspended');
      if (call === 1) {
        ctx.resume = vi.fn(async () => {
          throw new Error('resume blocked');
        });
      }
      created.push(ctx);
      return ctx;
    });

    const ok = await unlockAudio('recreate');
    expect(ok).toBe(true);
    expect(MockAudioContext).toHaveBeenCalledTimes(2);
    expect(created[1].resume).toHaveBeenCalled();
    expect(getAudioContextState()).toBe('running');
  });

  it('awaits running context before oscillator beep', async () => {
    let resumeResolve;
    const resumeGate = new Promise((resolve) => {
      resumeResolve = resolve;
    });

    MockAudioContext.mockImplementationOnce(() => {
      const ctx = createMockAudioContext('suspended');
      ctx.resume = vi.fn(() => resumeGate.then(() => {
        ctx.state = 'running';
      }));
      created.push(ctx);
      return ctx;
    });

    beep(880, 50, 0.2);
    expect(created[0].createOscillator).not.toHaveBeenCalled();

    resumeResolve();
    await vi.waitFor(() => {
      expect(created[0].createOscillator).toHaveBeenCalled();
    });
    expect(getAudioContextState()).toBe('running');
  });

  it('skips beep when context cannot reach running', async () => {
    MockAudioContext.mockImplementationOnce(() => {
      const ctx = createMockAudioContext('suspended');
      ctx.resume = vi.fn(async () => {
        // Stay suspended — iOS gesture gate.
        ctx.state = 'suspended';
      });
      created.push(ctx);
      return ctx;
    });

    beep(880, 50, 0.2);
    await vi.waitFor(() => {
      expect(created[0].resume).toHaveBeenCalled();
    });
    // Allow async playBeep to finish.
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0].createOscillator).not.toHaveBeenCalled();
    expect(getAudioContextState()).toBe('suspended');
  });

  it('recoverAudioAfterBackground resumes and re-primes on next gesture', async () => {
    recoverAudioAfterBackground();
    await vi.waitFor(() => {
      expect(created[0]?.resume).toHaveBeenCalled();
    });
    expect(getAudioContextState()).toBe('running');

    // Simulate iOS suspending again after lock while gesture primer is still armed.
    created[0].state = 'suspended';
    created[0].resume.mockClear();

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.waitFor(() => {
      expect(created[0].resume).toHaveBeenCalled();
    });
    expect(getAudioContextState()).toBe('running');
  });
});
