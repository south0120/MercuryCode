(() => {
  const c = document.querySelector(".hero-canvas");
  const m = matchMedia("(prefers-reduced-motion: reduce)");
  if (!c || m.matches) return;
  const x = c.getContext("2d");
  // Curated to feel like code: uppercase letters, digits, and structural symbols.
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}();<>=:[].,/_*";
  const N = 96;
  const drops = [];

  const resize = () => {
    c.width = innerWidth;
    c.height = c.offsetHeight;
  };
  resize();
  addEventListener("resize", resize, { passive: true });

  for (let i = 0; i < N; i++) {
    drops.push({
      // Skewed toward the left half so it complements the static hero image.
      x: Math.random() * c.width * 0.6,
      y: Math.random() * c.height,
      s: 12 + Math.random() * 14,
      v: 0.6 + Math.random() * 1.6,
      ch: CHARS[(Math.random() * CHARS.length) | 0],
      // Each drop has a slow phase so brightness pulses softly.
      phase: Math.random() * Math.PI * 2,
    });
  }

  let frame = 0;
  const tick = () => {
    x.clearRect(0, 0, c.width, c.height);
    frame++;
    const t = frame * 0.012;
    drops.forEach((d) => {
      d.y = (d.y + d.v) % (c.height + 24);
      if (Math.random() > 0.93) d.ch = CHARS[(Math.random() * CHARS.length) | 0];
      const lum = 0.16 + 0.18 * Math.max(0, Math.sin(t + d.phase));
      x.fillStyle = `rgba(0,255,255,${lum})`;
      x.font = `${d.s}px "JetBrains Mono", monospace`;
      x.fillText(d.ch, d.x, d.y);
    });
    requestAnimationFrame(tick);
  };
  tick();
})();
