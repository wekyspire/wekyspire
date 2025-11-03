<template>
  <div class="game-background-screen" ref="container"></div>
</template>

<script>
export default {
  name: 'GameBackgroundScreen',
  data() {
    return {
      app: null,
      bgSprite: null,
      filter: null,
      _onResize: null
    };
  },
  async mounted() {
    const PIXI = (await import('pixi.js')).default || await import('pixi.js');
    const Application = PIXI.Application || PIXI.Application;
    const Sprite = PIXI.Sprite || PIXI.Sprite;
    const Texture = PIXI.Texture || PIXI.Texture;
    const Filter = PIXI.Filter || PIXI.Filter;

    const app = new Application({
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0
    });
    this.app = app;

    const sprite = new Sprite(Texture.WHITE);
    sprite.width = app.renderer.width;
    sprite.height = app.renderer.height;

    const fragment = `
      precision mediump float;
      varying vec2 vTextureCoord;
      uniform float uTime;
      uniform vec2 uResolution;
      float rand(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453); }
      void main() {
        vec2 uv = vTextureCoord * uResolution / min(uResolution.x, uResolution.y);
        vec2 center = vec2(0.5 * uResolution / min(uResolution.x, uResolution.y));
        float d = distance(uv, center);
        float t = uTime * 0.01;
        float ring = 0.5 + 0.5 * sin(6.2831 * (d * 0.6 - t));
        float vignette = smoothstep(0.9, 0.2, d);
        float noise = rand(uv + t) * 0.03;
        vec3 col = mix(vec3(0.06, 0.08, 0.12), vec3(0.10, 0.14, 0.22), ring);
        col += noise;
        col *= vignette;
        gl_FragColor = vec4(col, 1.0);
      }
    `;
    const filter = new Filter(undefined, fragment, {
      uTime: 0,
      uResolution: new Float32Array([app.renderer.width, app.renderer.height])
    });
    this.filter = filter;
    sprite.filters = [filter];

    app.stage.addChild(sprite);
    this.bgSprite = sprite;

    this.$refs.container.appendChild(app.view);

    const onResize = () => {
      if (!this.app || !this.bgSprite || !this.filter) return;
      this.bgSprite.width = this.app.renderer.width;
      this.bgSprite.height = this.app.renderer.height;
      this.filter.uniforms.uResolution[0] = this.app.renderer.width;
      this.filter.uniforms.uResolution[1] = this.app.renderer.height;
    };
    window.addEventListener('resize', onResize);
    this._onResize = onResize;

    app.ticker.add((delta) => {
      if (this.filter) this.filter.uniforms.uTime += delta;
    });
  },
  beforeUnmount() {
    try { if (this._onResize) window.removeEventListener('resize', this._onResize); } catch(_) {}
    if (this.app) {
      try { this.app.destroy(true, { children: true, texture: true, baseTexture: true }); } catch(_) {}
      this.app = null;
    }
    this.filter = null;
    this.bgSprite = null;
  }
};
</script>

<style scoped>
.game-background-screen {
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
}
canvas { display: block; width: 100%; height: 100%; }
</style>
