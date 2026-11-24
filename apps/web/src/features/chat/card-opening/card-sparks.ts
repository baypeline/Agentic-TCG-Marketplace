const colors = ['#fff3bb', '#ffd872', '#ffb26a', '#86ecff', '#c5a2ff'];

export function startCardSparks(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const { clientWidth: width, clientHeight: height } = canvas;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.scale(scale, scale);
  const spread = Math.min(width, height);
  const particles = Array.from({ length: 112 }, (_, index) => {
    const angle = index * 2.39996;
    const speed = spread * (0.18 + Math.random() * 0.74);
    return {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
      depth: Math.random() * 0.8 - 0.4,
      size: 0.7 + Math.random() * 2.1,
      delay: Math.random() * 0.16,
      color: colors[index % colors.length]!,
      diamond: index % 9 === 0,
    };
  });

  let frame: number;
  let start: number | undefined;
  const draw = (now: number) => {
    start ??= now;
    const time = (now - start - 300) / 1000;
    ctx.clearRect(0, 0, width, height);

    for (const particle of particles) {
      const age = time - particle.delay;
      const opacity = 1 - age / 1.38;
      if (age < 0 || opacity <= 0) continue;
      const depth = 1 + particle.depth * age;
      const distance = (1 - Math.exp(-2.5 * age)) / depth;
      const x = width * 0.5 + particle.x * distance;
      const y = height * 0.49 + particle.y * distance + age * age * 32;
      const size = particle.size / depth;
      ctx.globalAlpha = opacity * Math.min(age * 20, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      if (particle.diamond) {
        ctx.moveTo(x, y - size * 4.8);
        ctx.lineTo(x + size * 1.7, y);
        ctx.lineTo(x, y + size * 4.8);
        ctx.lineTo(x - size * 1.7, y);
        ctx.closePath();
      } else {
        ctx.ellipse(x, y, size, size, 0, 0, 2 * Math.PI);
      }
      ctx.fill();
    }

    if (time < 1.6) frame = requestAnimationFrame(draw);
  };

  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, width, height);
  };
}
