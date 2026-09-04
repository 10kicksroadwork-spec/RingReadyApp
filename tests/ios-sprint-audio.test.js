import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

function createMockAudioContext(initialState = 'suspended') {
  const ctx = {
    state: initialState,
    currentTime: 0,
    sampleRate: 22050,
    destination: {},
    onstatechange: null,
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => {
      ctx.state = 'closed';
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
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
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
  let releaseAudioLocks;
  let MockAudioContext;
  let MockHtmlAudio;
  let created;
  let htmlPlay;

  beforeEach(async () => {
    vi.resetModules();
    created = [];
    htmlPlay = vi.fn(async () => {});
    MockAudioContext = vi.fn(function MockAudioContext() {
      const ctx = createMockAudioContext('suspended');
      created.push(ctx);
      return ctx;
    });
    MockHtmlAudio = vi.fn(function MockHtmlAudio() {
      this.playsInline = false;
      this.currentTime = 0;
      this.play = htmlPlay;
      this.pause = vi.fn();
      this.setAttribute = vi.fn();
    });
    window.AudioContext = MockAudioContext;
    window.webkitAudioContext = MockAudioContext;
    globalThis.Audio = MockHtmlAudio;
    document.body.innerHTML = '<div id="toast"></div>';

    const ui = await import('../src/ui.js');
    unlockAudio = ui.unlockAudio;
    beep = ui.beep;
    getAudioContextState = ui.getAudioContextState;
    recoverAudioAfterBackground = ui.recoverAudioAfterBackground;
    releaseAudioLocks = ui.releaseAudioLocks;
  });

  afterEach(() => {
    try {
      releaseAudioLocks?.();
    } catch {
      /* module may already be reset */
    }
    delete window.AudioContext;
    delete window.webkitAudioContext;
    delete globalThis.Audio;
    vi.restoreAllMocks();
  });

  it('reports none before any unlock', () => {
    expect(getAudioContextState()).toBe('none');
  });

  it('awaits resume from suspended and returns running', async () => {
    const ok = await unlockAudio('test', { fromGesture: true });
    expect(ok).toBe(true);
    expect(MockAudioContext).toHaveBeenCalledTimes(1);
    expect(created[0].resume).toHaveBeenCalledTimes(1);
    expect(getAudioContextState()).toBe('running');
    expect(created[0].createBufferSource).toHaveBeenCalled();
    expect(htmlPlay).toHaveBeenCalled();
  });

  it('resumes interrupted contexts', async () => {
    MockAudioContext.mockImplementationOnce(() => {
      const ctx = createMockAudioContext('interrupted');
      created.push(ctx);
      return ctx;
    });

    const ok = await unlockAudio('interrupted', { fromGesture: true });
    expect(ok).toBe(true);
    expect(getAudioContextState()).toBe('running');
  });

  it('recreates context on gesture when prior context is interrupted', async () => {
    await unlockAudio('setup', { fromGesture: true });
    expect(getAudioContextState()).toBe('running');
    created[0].state = 'interrupted';

    const ok = await unlockAudio('after-lock', { fromGesture: true });
    expect(ok).toBe(true);
    expect(MockAudioContext).toHaveBeenCalledTimes(2);
    expect(created[0].close).toHaveBeenCalled();
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

    const ok = await unlockAudio('recreate', { fromGesture: true });
    expect(ok).toBe(true);
    expect(MockAudioContext).toHaveBeenCalledTimes(2);
    expect(created[1].resume).toHaveBeenCalled();
    expect(getAudioContextState()).toBe('running');
  });

  it('awaits running context before oscillator beep and also tries HTMLAudio', async () => {
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
    expect(created[0].createGain().gain.linearRampToValueAtTime).toBeDefined();
    expect(getAudioContextState()).toBe('running');
    await vi.waitFor(() => {
      expect(MockHtmlAudio).toHaveBeenCalled();
    });
  });

  it('falls back to HTMLAudio and prompts tap when web audio stays suspended', async () => {
    htmlPlay.mockImplementation(async () => {
      throw new Error('NotAllowedError');
    });
    MockAudioContext.mockImplementationOnce(() => {
      const ctx = createMockAudioContext('suspended');
      ctx.resume = vi.fn(async () => {
        ctx.state = 'suspended';
      });
      created.push(ctx);
      return ctx;
    });

    beep(880, 50, 0.2);
    await vi.waitFor(() => {
      expect(created[0].resume).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(document.getElementById('toast').textContent).toBe('TAP FOR SOUND');
    });
    expect(created[0].createOscillator).not.toHaveBeenCalled();
  });

  it('keeps gesture reprime armed until unlock succeeds after background', async () => {
    // First foreground attempt cannot run without gesture.
    MockAudioContext.mockImplementation(() => {
      const ctx = createMockAudioContext('suspended');
      ctx.resume = vi.fn(async () => {
        ctx.state = 'suspended';
      });
      created.push(ctx);
      return ctx;
    });

    recoverAudioAfterBackground();
    await vi.waitFor(() => {
      expect(created[0]?.resume).toHaveBeenCalled();
    });
    expect(getAudioContextState()).toBe('suspended');

    // Next tap uses fromGesture path and recreates a runnable context.
    let gestureCalls = 0;
    MockAudioContext.mockImplementation(() => {
      gestureCalls += 1;
      const ctx = createMockAudioContext('suspended');
      ctx.resume = vi.fn(async () => {
        ctx.state = 'running';
      });
      created.push(ctx);
      return ctx;
    });

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.waitFor(() => {
      expect(gestureCalls).toBeGreaterThan(0);
      expect(getAudioContextState()).toBe('running');
    });
  });

  it('sets navigator.audioSession type to playback when available', async () => {
    navigator.audioSession = { type: 'auto' };
    await unlockAudio('session', { fromGesture: true });
    expect(navigator.audioSession.type).toBe('playback');
    delete navigator.audioSession;
  });
});
