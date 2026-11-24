const colors = ['#fff5c6', '#ffd783', '#91edff', '#bcabff', '#ff9dda'];

export function startCardSparks(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const { clientWidth: width, clientHeight: height } = canvas;
  if (!width || !height) return;

  const scale = Math.min(window.devicePixelRatio || 1, 1.6, 2800 / Math.max(width, height));
  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.scale(scale, scale);
  const spread = Math.min(width, height);
  const particles = Array.from({ length: 156 }, (_, index) => {
    const angle = index * 2.39996;
    return {
      angle,
      speed: spread * (0.22 + Math.random() * 0.95),
      depth: Math.random() * 0.75 - 0.3,
      size: 0.75 + Math.random() * 2.6,
      delay: Math.random() * 0.19,
      rotation: (Math.random() - 0.5) * 14,
      color: colors[index % colors.length]!,
      shard: index % 6 === 0,
    };
  });

  let frame: number;
  let start: number | undefined;
  const draw = (now: number) => {
    start ??= now;
    const time = (now - start - 420) / 1000;
    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      const age = time - p.delay;
      const opacity = 1 - age / 1.47;
      if (age < 0 || opacity <= 0) continue;
      const depth = 1 + p.depth * age;
      const radius = p.speed * (1 - Math.exp(-2.65 * age)) / depth;
      const directionX = Math.cos(p.angle);
      const directionY = Math.sin(p.angle);
      const x = width * 0.5 + directionX * radius;
      const y = height * 0.47 + directionY * radius + age * age * 44;
      const size = p.size / depth;
      ctx.globalAlpha = opacity ** 1.15 * Math.min(age * 24, 1);
      ctx.fillStyle = p.color;

      if (p.shard) {
        const rotation = p.angle + age * p.rotation;
        const stretch = size * (1.5 + Math.abs(Math.sin(age * p.rotation)) * 4.3);
        const dx = Math.cos(rotation) * stretch;
        const dy = Math.sin(rotation) * stretch;
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x - dy * 0.26, y + dx * 0.26);
        ctx.lineTo(x - dx * 0.8, y - dy * 0.8);
        ctx.lineTo(x + dy * 0.32, y - dx * 0.32);
        ctx.fill();
      } else {
        const trail = size * (1 + 16 * Math.exp(-age * 4));
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(size * 0.6, 1);
        ctx.beginPath();
        ctx.moveTo(x - directionX * trail, y - directionY * trail);
        ctx.lineTo(x, y);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, size * 0.62, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (time < 1.68) frame = requestAnimationFrame(draw);
  };

  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, width, height);
  };
}
