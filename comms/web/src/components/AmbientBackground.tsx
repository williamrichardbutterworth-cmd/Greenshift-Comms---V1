import { useEffect, useRef } from 'react';

// Purely decorative, full-viewport canvas behind the app. A few very soft green
// light fields, composed around the centre, drift and breathe on long (20–40s)
// cycles — a quiet, premium sense of motion that never competes with the content.
// Tuned for the Green Shift brand (#40A800) on the light #FAFBFA surface. Sits at
// z-0 (the content column is lifted to z-10), pointer-events:none + aria-hidden,
// so it never affects layout or interaction. Respects prefers-reduced-motion
// (renders one static frame, no animation).

const GREEN = '64,168,0'; // #40A800

type Glow = {
  bx: number; by: number; // base centre (fraction of viewport)
  ax: number; ay: number; // drift amplitude (fraction)
  r: number; rr: number; // base radius + breathe (fraction of min side)
  a: number; // peak alpha
  sp: number; ph: number; // drift speed + phase
};

// Centre-weighted composition: one broad central field with two softer satellites.
const GLOWS: Glow[] = [
  { bx: 0.5, by: 0.42, ax: 0.05, ay: 0.04, r: 0.62, rr: 0.08, a: 0.085, sp: 0.2, ph: 0 },
  { bx: 0.38, by: 0.58, ax: 0.06, ay: 0.05, r: 0.42, rr: 0.09, a: 0.07, sp: 0.27, ph: 2.1 },
  { bx: 0.64, by: 0.48, ax: 0.05, ay: 0.06, r: 0.46, rr: 0.09, a: 0.065, sp: 0.23, ph: 4.2 },
];

export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    const resize = () => {
      // Size from the VIEWPORT, never the canvas's own box (a fixed replaced element
      // keeps its intrinsic size, so reading its rect would feed back and balloon).
      w = Math.max(1, window.innerWidth);
      h = Math.max(1, window.innerHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const minSide = Math.min(w, h);
      for (const g of GLOWS) {
        const cx = (g.bx + Math.sin(t * g.sp * 0.001 + g.ph) * g.ax) * w;
        const cy = (g.by + Math.cos(t * g.sp * 0.0011 + g.ph * 1.3) * g.ay) * h;
        const rad = (g.r + Math.sin(t * 0.0004 + g.ph) * g.rr) * minSide;
        const a = g.a * (0.82 + 0.18 * Math.sin(t * 0.0005 + g.ph));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, `rgba(${GREEN},${a})`);
        grad.addColorStop(1, `rgba(${GREEN},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    };

    if (reduce) {
      draw(0);
      const onResize = () => {
        resize();
        draw(0);
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    window.addEventListener('resize', resize);
    let raf = 0;
    const frame = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="fixed inset-0 z-0 pointer-events-none" />;
}
