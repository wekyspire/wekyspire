// filepath: src/renderers/effects/pulse/burn.js
import * as PIXI from 'pixi.js';
import { EffectKinds, genEffectId } from '../core.js';

// A simple burn prototype: over duration, dissolve with noise and warm glow,
// fade the sprite to transparent. No interruptions; auto-finish and cleanup.
export default function createBurn(options = {}) {
  const duration = typeof options.duration === 'number' ? options.duration : 850;
  const color = options.color || [1.0, 0.4, 0.15]; // warm orange glow
  const dissolveEdge = options.edgeWidth || 0.10;  // edge softness
  const glowIntensity = options.glow || 0.99;

  const passThroughFrag = `
    precision mediump float;
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    void main(void){ gl_FragColor = texture2D(uSampler, vTextureCoord); }
  `;

  const copy = new PIXI.Filter(undefined, passThroughFrag);
  copy.autoFit = true; copy.padding = 0;

  const fragment = `
    precision mediump float;
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    
    // time progress 0..1
    uniform float uPhase;
    uniform vec3 uGlowColor;
    uniform float uGlowIntensity;
    uniform float uEdge;

    // Simple hash-based noise (cheap)
    float hash(vec2 p){
      p = fract(p*vec2(123.34, 456.21));
      p += dot(p, p+45.32);
      return fract(p.x*p.y);
    }
    
    float noise(vec2 p){
      vec2 i = floor(p);
      vec2 f = fract(p);
      // 4 corners
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      // bilerp
      vec2 u = f*f*(3.0-2.0*f);
      return mix(a, b, u.x) + (c - a)*u.y*(1.0 - u.x) + (d - b)*u.x*u.y;
    }

    void main(){
      vec4 base = texture2D(uSampler, vTextureCoord);
      // dissolve threshold grows with phase; scale noise to get varied edges
      float n = noise(vTextureCoord * 64.0);
      float threshold = uPhase * 1.2; // expand slightly beyond 1 for full clear
      float d = smoothstep(threshold - uEdge, threshold - uEdge * 2.0, n);
      float dGlow = smoothstep(threshold + uEdge * 1.0, threshold, n);
      float dRust = smoothstep(threshold, threshold - uEdge * 1.0, n);

      // d ~ 0: intact, d ~ 1: dissolved
      float alpha = base.a * (1.0 - d);

      // glow only near the dissolving frontier
      float rim = smoothstep(0.4, 0.0, max(0.5 - dGlow, 0.0));
      float glow = uGlowIntensity * rim;
      // Turns into dark rust after glowing
      float rust = smoothstep(0.3, 0.0, max(0.5 - dRust, 0.0));

      // composite: brighten remaining color slightly with glow
      vec3 col = mix(base.rgb, uGlowColor, glow);
      // add rust tint
      col = mix(col, vec3(0.2, 0.05, 0.0), rust);
      
      
      // output premultiplied alpha to match Pixi's pipeline
      col *= alpha;
      gl_FragColor = vec4(col, alpha);
    }
  `;

  const uniforms = {
    uPhase: 0,
    uGlowColor: color,
    uGlowIntensity: glowIntensity,
    uEdge: dissolveEdge
  };

  const filter = new PIXI.Filter(undefined, fragment, uniforms);
  filter.autoFit = true;
  filter.padding = 0;

  let t = 0;
  let destroyed = false;

  return {
    kind: EffectKinds.PULSE,
    name: 'pulse:burn',
    id: options.id || genEffectId('pulse'),
    filters: [copy, filter],
    update(dt) {
      if (destroyed) return true;
      t += dt;
      const phase = Math.min(1, t / duration);
      filter.uniforms.uPhase = phase;
      return t >= duration;
    },
    interrupt() {
      // burn is not intended to be interrupted; force finish
      t = duration;
    },
    destroy() {
      destroyed = true;
      try { filter.destroy?.(); } catch (_) {}
      try { copy.destroy?.(); } catch (_) {}
    }
  };
}
