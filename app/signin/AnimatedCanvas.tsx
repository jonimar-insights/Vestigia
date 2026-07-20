"use client";

import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import AnimatedBackground from "./AnimatedBackground";

export default function AnimatedCanvas() {
  return (
    <Canvas
      orthographic
      camera={{ zoom: 1, position: [0, 0, 1] }}
      gl={{ antialias: true, alpha: false }}
    >
      <AnimatedBackground />
      <EffectComposer>
        <Bloom
          intensity={0.7}
          luminanceThreshold={0.4}
        />
      </EffectComposer>
    </Canvas>
  );
}