const ALERT_TITLE = '🔔 Rakip bulundu!';

/** Must be called from a user gesture so browsers allow sound later. */
export function createChime(): (() => void) | null {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();
  void context.resume();

  return () => {
    const start = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = start + index * 0.18;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.25, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.3);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.32);
    });
  };
}

/** Flashes the tab title until the tab is visible again. Returns a stop function. */
export function flashTitle(): () => void {
  const original = document.title;
  let showingAlert = false;

  const interval = window.setInterval(() => {
    showingAlert = !showingAlert;
    document.title = showingAlert ? ALERT_TITLE : original;
  }, 800);

  const stop = () => {
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibility);
    document.title = original;
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') stop();
  };
  document.addEventListener('visibilitychange', onVisibility);
  if (document.visibilityState === 'visible') window.setTimeout(stop, 3000);
  return stop;
}
