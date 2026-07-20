"use client";

import { useEffect, useRef } from "react";

export function LightningBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.src = "/bg.jpg";

    let raf: number;
    let w = 0;
    let h = 0;
    let imgLoaded = false;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
      if (imgLoaded) draw(0);
    }

    img.onload = () => {
      imgLoaded = true;
      resize();
    };

    window.addEventListener("resize", resize);

    interface Streak {
      angle: number;
      x: number;
      y: number;
      width: number;
      speed: number;
      opacity: number;
      life: number;
      maxLife: number;
    }

    let streaks: Streak[] = [];
    let lastSpawn = 0;
    let ambientGlow = 0;

    function spawnStreak() {
      const angle = -0.3 + Math.random() * 0.6;
      streaks.push({
        angle,
        x: Math.random() * w,
        y: -50,
        width: 80 + Math.random() * 200,
        speed: 600 + Math.random() * 800,
        opacity: 0.15 + Math.random() * 0.25,
        life: 0,
        maxLife: 40 + Math.floor(Math.random() * 30),
      });
    }

    function draw(t: number) {
      if (!ctx || !imgLoaded) return;

      ctx.clearRect(0, 0, w, h);

      // Draw the base image slightly darkened
      ctx.filter = "brightness(0.55) contrast(1.1)";
      ctx.drawImage(img, 0, 0, w, h);
      ctx.filter = "none";

      // Spawn new streaks
      if (t - lastSpawn > 2000 + Math.random() * 4000) {
        spawnStreak();
        if (Math.random() > 0.5) spawnStreak();
        ambientGlow = 0.06 + Math.random() * 0.04;
        lastSpawn = t;
      }

      // Ambient flash
      if (ambientGlow > 0.001) {
        ctx.fillStyle = `rgba(180, 200, 255, ${ambientGlow})`;
        ctx.fillRect(0, 0, w, h);
        ambientGlow *= 0.92;
      }

      // Draw each streak
      for (const s of streaks) {
        s.life++;
        const progress = s.life / s.maxLife;
        const fadeIn = Math.min(progress * 5, 1);
        const fadeOut = Math.max(1 - (progress - 0.6) / 0.4, 0);
        const alpha = s.opacity * fadeIn * (progress > 0.6 ? fadeOut : 1);

        if (alpha <= 0) continue;

        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);

        // Main streak beam
        const grad = ctx.createLinearGradient(0, -s.width / 2, 0, s.width / 2);
        grad.addColorStop(0, "rgba(180, 210, 255, 0)");
        grad.addColorStop(0.3, `rgba(200, 220, 255, ${alpha * 0.3})`);
        grad.addColorStop(0.5, `rgba(240, 245, 255, ${alpha})`);
        grad.addColorStop(0.7, `rgba(200, 220, 255, ${alpha * 0.3})`);
        grad.addColorStop(1, "rgba(180, 210, 255, 0)");

        ctx.fillStyle = grad;
        ctx.fillRect(-30, -s.width / 2, 60, s.width);

        // Bright core
        const coreGrad = ctx.createLinearGradient(0, -s.width * 0.1, 0, s.width * 0.1);
        coreGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
        coreGrad.addColorStop(0.5, `rgba(255, 255, 255, ${alpha * 0.8})`);
        coreGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = coreGrad;
        ctx.fillRect(-20, -s.width * 0.1, 40, s.width * 0.2);

        ctx.restore();

        s.y += s.speed * 0.016;
      }

      streaks = streaks.filter((s) => s.life <= s.maxLife);

      raf = requestAnimationFrame(frame);
    }

    function frame(t: number) {
      draw(t);
    }

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-10"
    />
  );
}
