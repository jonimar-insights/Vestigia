"use client";

import { useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";

const vertex = `
varying vec2 vUv;

void main() {
    vUv = uv;

    gl_Position =
        projectionMatrix *
        modelViewMatrix *
        vec4(position, 1.0);
}
`;

const fragment = `
uniform sampler2D uTexture;
uniform float uTime;

varying vec2 vUv;

float random(vec2 st){
    return fract(
        sin(dot(st.xy, vec2(12.9898,78.233)))
        *43758.5453123
    );
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(random(i + vec2(0.0, 0.0)), random(i + vec2(1.0, 0.0)), u.x),
        mix(random(i + vec2(0.0, 1.0)), random(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

// 2D simplex-like noise (vec3 input, uses z for time slice)
float snoise(vec3 p) {
    float z = floor(p.z);
    float fz = fract(p.z);
    return mix(noise(p.xy + z), noise(p.xy + z + 1.0), fz);
}

void main(){
    vec2 uv = vUv;

    // ── Sine wave streaks ──
    float wave =
        sin(uv.y*12.0 + uTime*0.4) * 0.003;
    float wave2 =
        cos(uv.x*10.0 - uTime*0.25) * 0.003;

    uv.x += wave;
    uv.y += wave2;

    // ── 3D noise displacement (organic flow) ──
    uv += snoise(vec3(uv*2.0, uTime*0.05)) * 0.008;

    // ── Chromatic aberration ──
    float d = snoise(vec3(uv*2.0, uTime*0.05)) * 0.004;

    vec4 r = texture2D(uTexture, uv + d);
    vec4 g = texture2D(uTexture, uv);
    vec4 b = texture2D(uTexture, uv - d);

    gl_FragColor = vec4(r.r, g.g, b.b, 1.0);
}
`;

export default function AnimatedBackground() {
  const texture = useLoader(THREE.TextureLoader, "/bg.jpg");
  const material = useRef<THREE.ShaderMaterial>(null);

  useFrame(({ clock }) => {
    if (material.current) {
      const u = material.current.uniforms;
      if (u.uTime) u.uTime.value = clock.elapsedTime;
    }
  });

  return (
    <mesh scale={[2, 2, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={material}
        uniforms={{
          uTexture: { value: texture },
          uTime: { value: 0 },
        }}
        vertexShader={vertex}
        fragmentShader={fragment}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}