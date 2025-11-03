// filepath: src/renderers/effects/pulse/cooldown.js
import * as PIXI from 'pixi.js';
import { EffectKinds, genEffectId } from '../core.js';

export default function createCooldown(options = {}) {
  const duration = typeof options.duration === 'number' ? options.duration : 600;
  const reverse = !!options.reverseCooldown;
  const strong = !!options.strongCooldown;

  // Colors: strong -> yellow, reverse -> red, else -> green
  // If reverse provided, prefer red over strong; else strong yellow; else green
  const color = reverse
    ? [0.8, 0.04, 0.04]
    : (strong ? [1.0, 0.84, 0.2] : [0.0, 0.8, 0.1]);

  const vertex = `
    attribute vec2 aVertexPosition;
  
    uniform mat3 projectionMatrix;
    
    varying vec2 vTextureCoord;
    varying vec2 vUniformCoord;
    
    uniform vec4 inputSize;
    uniform vec4 outputFrame;
    uniform vec2 resolution;
    
    vec4 filterVertexPosition( void )
    {
        vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
    
        return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    }
    
    vec2 filterTextureCoord( void )
    {
        return aVertexPosition * (outputFrame.zw * inputSize.zw);
    }
    
    void main(void)
    {
        gl_Position = filterVertexPosition();
        vTextureCoord = filterTextureCoord();
        float aspect = 198.0 / 266.0;
        vUniformCoord = 2.0 * (aVertexPosition - 0.5);
        vUniformCoord.x *= aspect;
    }
  `;

  const fragment = `
    precision mediump float;
    varying vec2 vTextureCoord;
    varying vec2 vUniformCoord;
    uniform sampler2D uSampler;

    uniform vec3 uColor;          // overlay color
    uniform float uPhase;         // 0..1
    uniform float uDir;           // +1 or -1
    uniform float uInnerR;        // normalized [0,1]
    uniform float uOuterR;        // normalized [0,1]
    uniform float uArcHalf;       // radians
    uniform float uOpacity;       // 0..1

    // wrap angle to (-PI, PI]
    float angleDiff(float a, float b) {
      float d = a - b;
      const float PI_ = 3.1415926535897932384626433832795;
      const float TWO_PI = 6.283185307179586476925286766559;
      d = mod(d + PI_, TWO_PI) - PI_;
      return d;
    }

    void main() {
      vec4 base = texture2D(uSampler, vTextureCoord);

      vec2 p = vUniformCoord; // center at 0, isotropic scale

      float r = length(p);
      float a = atan(p.y, p.x); // -PI..PI

      // Target angle rotates with phase and direction
      const float TWO_PI = 6.283185307179586476925286766559;
      float target = (uDir > 0.0 ? 1.0 : -1.0) * (uPhase * TWO_PI);

      // Radial ring mask
      float inner = uInnerR;
      float outer = uOuterR;
      float radial = smoothstep(inner, inner + 0.003, r) * (1.0 - smoothstep(outer - 0.003, outer, r));

      // Angular arc mask with soft edges
      float da = abs(angleDiff(a, target));
      float ang = 1.0 - smoothstep(uArcHalf, uArcHalf + 0.25, da);

      float mask = radial * ang;
      float alpha = clamp(uOpacity, 0.0, 1.0);
      // Smooth in-out over phase
      // Smooth in for 0-0.25, smooth out for 0.75-1.0
      if (uPhase < 0.25) {
        float pIn = uPhase / 0.25;
        alpha = mix(0.0, alpha, smoothstep(0.0, 1.0, pIn));
      } else if (uPhase > 0.75) {
        float pOut = (uPhase - 0.75) / 0.25;
        alpha = mix(alpha, 0.0, smoothstep(0.0, 1.0, pOut));
      }

      // Composite (screen-ish blend)
      vec3 overlay = (1.0 - mask) * uColor + mask * vec3(1.0);
      vec3 outRGB = mix(base.rgb, 1.0 - (1.0 - overlay) * (1.0 - base.rgb), alpha);
      gl_FragColor = vec4(outRGB, base.a);
    }
  `;

  // Defaults for ring
  const uniforms = {
    uColor: color,
    uPhase: 0,
    uDir: reverse ? -1 : 1,
    uInnerR: 0.24,
    uOuterR: 0.30,
    uArcHalf: Math.PI * 0.18, // ~20deg half-width
    uOpacity: 1.0
  };

  const filter = new PIXI.Filter(vertex, fragment, uniforms);
  filter.autoFit = true;
  filter.padding = 2;

  let t = 0;
  let destroyed = false;

  return {
    kind: EffectKinds.PULSE,
    name: 'pulse:cooldown',
    id: options.id || genEffectId('pulse'),
    filters: [filter],
    update(dt) {
      if (destroyed) return true;
      t += dt;
      filter.uniforms.uPhase = Math.min(1, t / duration);
      return t >= duration;
    },
    interrupt() {
      t = duration;
    },
    destroy() {
      destroyed = true;
      try { filter.destroy?.(); } catch(_) {}
    }
  };
}
