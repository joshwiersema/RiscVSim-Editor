import { useEffect } from 'react';
import { useStore } from '../state/store';

/** Drives auto-play: steps whole cycles or datapath phases at `speed` per second. */
export function usePlayback(): void {
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const playMode = useStore((s) => s.playMode);

  useEffect(() => {
    if (!playing) return;
    const interval = Math.max(20, 1000 / speed);
    const id = window.setInterval(() => {
      const s = useStore.getState();
      if (!s.machine || s.machine.finished) { s.setPlaying(false); return; }
      if (s.playMode === 'phase') s.subStep(); else s.step();
      const m = useStore.getState().machine;
      if (m && m.breakpoints.size && m.breakpoints.has(m.core.pc) && s.playMode === 'cycle') {
        useStore.setState({ playing: false, status: `Paused at breakpoint (PC 0x${m.core.pc.toString(16)}).` });
      }
    }, interval);
    return () => window.clearInterval(id);
  }, [playing, speed, playMode]);
}
