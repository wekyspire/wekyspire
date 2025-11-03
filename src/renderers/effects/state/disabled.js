// filepath: src/renderers/effects/state/disabled.js
import * as PIXI from 'pixi.js';
import { EffectKinds, genEffectId } from '../core.js';

export default function createDisabled(options = {}) {
  const amount = (typeof options.amount === 'number') ? options.amount : 1.0; // 0..1
  const alphaMul = (typeof options.alpha === 'number') ? options.alpha : 0.5;   // 0..1

  const passThroughFrag = `
    precision mediump float;
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    void main(void){ gl_FragColor = texture2D(uSampler, vTextureCoord); }
  `;

  const copy = new PIXI.Filter(undefined, passThroughFrag);
  copy.autoFit = true; copy.padding = 0;

  const disabledFrag = `
    precision mediump float;
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    uniform float uAlpha;
    uniform float uDesaturate;
    void main(void){
      vec4 c = texture2D(uSampler, vTextureCoord);
      // Luma coefficients (sRGB)
      float g = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 rgb = mix(c.rgb, vec3(g), clamp(uDesaturate, 0.0, 1.0));
      // Darken slightly
      rgb *= 1.0 - 0.3 * clamp(uDesaturate, 0.0, 1.0);
      gl_FragColor = vec4(rgb, c.a);
    }
  `;

  const uniforms = { uAlpha: alphaMul, uDesaturate: amount };
  const disabled = new PIXI.Filter(undefined, disabledFrag, uniforms);
  disabled.autoFit = true; disabled.padding = 1;

  return {
    kind: EffectKinds.STATE,
    name: 'state:disabled',
    id: options.id || genEffectId('state'),
    filters: [copy, disabled],
    interrupt() {},
    destroy() {
      try { disabled.destroy?.(); } catch(_) {}
      try { copy.destroy?.(); } catch(_) {}
    }
  };
}
