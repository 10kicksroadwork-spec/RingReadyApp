import assert from 'node:assert/strict';

class FakeWindow {
  constructor() {
    this.listeners = new Map();
    this.history = new FakeHistory(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

class FakeHistory {
  constructor(fakeWindow) {
    this.fakeWindow = fakeWindow;
    this.stack = [];
    this.index = -1;
  }

  get length() {
    return this.stack.length;
  }

  replaceState(state) {
    if (this.index < 0) {
      this.stack.push(state);
      this.index = 0;
      return;
    }
    this.stack[this.index] = state;
  }

  pushState(state) {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(state);
    this.index += 1;
  }

  back() {
    if (this.index <= 0) return;
    this.index -= 1;
    this.fakeWindow.dispatch('popstate', { state: this.stack[this.index] });
  }

  forward() {
    if (this.index >= this.stack.length - 1) return;
    this.index += 1;
    this.fakeWindow.dispatch('popstate', { state: this.stack[this.index] });
  }
}

const fakeWindow = new FakeWindow();
globalThis.window = fakeWindow;
globalThis.document = { title: 'Ring Ready' };

const navigation = await import('../src/navigation.js');
const rendered = [];
let lockBack = false;

navigation.initNavigation({
  initialScreen: 'boot',
  onRender: (route) => rendered.push(route),
  shouldLockBack: () => lockBack,
});

navigation.replaceRoute('home');
navigation.navigate('athlete-profile');
fakeWindow.history.back();
assert.equal(navigation.getCurrentRoute().screenId, 'home');
fakeWindow.history.forward();
assert.equal(navigation.getCurrentRoute().screenId, 'athlete-profile');

navigation.replaceRoute('home');
const lengthBeforeDrawer = fakeWindow.history.length;
navigation.openOverlay('drawer');
navigation.openOverlay('drawer');
assert.equal(fakeWindow.history.length, lengthBeforeDrawer + 1);
assert.equal(navigation.getCurrentRoute().overlay, 'drawer');
navigation.closeOverlay('drawer');
assert.equal(navigation.getCurrentRoute().screenId, 'home');
assert.equal(navigation.getCurrentRoute().overlay, '');

navigation.navigate('workout-detail', { weekIndex: 1, workoutIndex: 2 });
navigation.navigate('setup', { workoutContext: { weekIndex: 1, workoutIndex: 2 } });
fakeWindow.history.back();
assert.deepEqual(navigation.getCurrentRoute().payload, { weekIndex: 1, workoutIndex: 2 });
fakeWindow.history.forward();
assert.equal(navigation.getCurrentRoute().screenId, 'setup');

navigation.navigate('session', { workoutContext: { weekIndex: 1, workoutIndex: 2 } });
lockBack = true;
fakeWindow.history.back();
assert.equal(navigation.getCurrentRoute().screenId, 'session');

lockBack = false;
navigation.replaceRoute('results', { record: { id: 'test-result' } });
fakeWindow.history.back();
assert.equal(navigation.getCurrentRoute().screenId, 'setup');
fakeWindow.history.forward();
assert.equal(navigation.getCurrentRoute().screenId, 'results');

assert.ok(rendered.some((route) => route.overlay === 'drawer'));
console.log('Navigation history smoke tests passed.');

