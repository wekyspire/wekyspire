/**
 * 粒子效果助手工具
 * 提供多种预设模式来生成粒子，兼容 ParticleEffectManager
 */

import frontendEventBus from '../frontendEventBus.js';

/**
 * 默认粒子参数
 */
const DEFAULT_PARTICLE_PARAMS = {
  size: 8,
  life: 1500,
  opacity: 1,
  fadeIn: false,
  opacityFade: true,
  sizeFade: true,
  gravity: 50,
  drag: 0.5,
  rotation: 0,
  zIndex: 1,
  color: '#ffffff',
  text: null,
  texture: null,
  extraStyles: {},
  customForce: null,
  customTrajectory: null,
  update: null
};

/**
 * 分布类型枚举
 */
export const DISTRIBUTION_TYPES = {
  UNIFORM: 'uniform',           // 均匀分布
  NORMAL: 'normal',            // 正态分布
  RADIAL: 'radial',            // 径向分布
  CLUSTER: 'cluster',          // 聚集分布
  GRID: 'grid',                // 网格分布
  SPIRAL: 'spiral',            // 螺旋分布
  EDGE: 'edge'                 // 边缘分布
};

/**
 * 常用颜色预设
 */
export const COLOR_PRESETS = {
  FIRE: ['#ff4444', '#ff8844', '#ffaa44', '#ffcc44'],
  ICE: ['#44aaff', '#88ccff', '#aaddff', '#cceeFF'],
  NATURE: ['#44ff44', '#88ff88', '#aaff88', '#ccffaa'],
  MAGIC: ['#aa44ff', '#cc88ff', '#ddaaff', '#eeccff'],
  GOLD: ['#ffd700', '#ffed4e', '#fff68f', '#fffacd'],
  BLOOD: ['#8b0000', '#dc143c', '#ff6347', '#ffa07a'],
  ELECTRIC: ['#00ffff', '#40e0d0', '#87ceeb', '#e0ffff']
};

/**
 * 粒子效果助手类
 */
class ParticleHelper {
  /**
   * 创建基础粒子对象
   * @param {Object} params - 粒子参数
   * @returns {Object} 粒子对象
   */
  static createParticle(params = {}) {
    return {
      ...DEFAULT_PARTICLE_PARAMS,
      ...params
    };
  }

  /**
   * 从 DOM 元素边缘生成向外散放的粒子
   * @param {HTMLElement|string} element - DOM 元素或选择器
   * @param {Object} options - 配置选项
   * @returns {Array} 粒子数组
   */
  static createEdgeBurstParticles(element, options = {}) {
    const {
      count = 20,
      speed = 100,
      speedVariation = 0.5,
      angleSpread = Math.PI * 2,
      edgeOnly = true,
      cornerBoost = 1.5,
      particleParams = {},
      emit = true
    } = options;

    // 获取 DOM 元素
    const domElement = typeof element === 'string' ? document.querySelector(element) : element;
    if (!domElement) {
      console.warn('ParticleHelper: Element not found');
      return [];
    }

    const rect = domElement.getBoundingClientRect();
    const particles = [];

    for (let i = 0; i < count; i++) {
      let x, y, angle;
      
      if (edgeOnly) {
        // 在边缘生成粒子
        const edge = Math.floor(Math.random() * 4); // 0: top, 1: right, 2: bottom, 3: left
        const t = Math.random();
        
        switch (edge) {
          case 0: // top
            x = rect.left + t * rect.width;
            y = rect.top;
            angle = -Math.PI / 2 + (Math.random() - 0.5) * angleSpread * 0.5;
            break;
          case 1: // right
            x = rect.right;
            y = rect.top + t * rect.height;
            angle = 0 + (Math.random() - 0.5) * angleSpread * 0.5;
            break;
          case 2: // bottom
            x = rect.left + t * rect.width;
            y = rect.bottom;
            angle = Math.PI / 2 + (Math.random() - 0.5) * angleSpread * 0.5;
            break;
          case 3: // left
            x = rect.left;
            y = rect.top + t * rect.height;
            angle = Math.PI + (Math.random() - 0.5) * angleSpread * 0.5;
            break;
        }

        // 角落增强效果
        const distanceToCorner = Math.min(
          Math.min(t, 1 - t) * (edge % 2 === 0 ? rect.width : rect.height)
        );
        const cornerFactor = distanceToCorner < 20 ? cornerBoost : 1;
        
        const finalSpeed = speed * cornerFactor * (1 + (Math.random() - 0.5) * speedVariation);
        const vx = Math.cos(angle) * finalSpeed;
        const vy = Math.sin(angle) * finalSpeed;

        particles.push(this.createParticle({
          x, y, vx, vy,
          ...particleParams
        }));
      } else {
        // 在整个元素区域内生成粒子
        x = rect.left + Math.random() * rect.width;
        y = rect.top + Math.random() * rect.height;
        angle = Math.random() * angleSpread;
        
        const finalSpeed = speed * (1 + (Math.random() - 0.5) * speedVariation);
        const vx = Math.cos(angle) * finalSpeed;
        const vy = Math.sin(angle) * finalSpeed;

        particles.push(this.createParticle({
          x, y, vx, vy,
          ...particleParams
        }));
      }
    }

    if (emit) {
      this.emitParticles(particles);
    }

    return particles;
  }

  /**
   * 从指定点向外散放粒子
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 配置选项
   * @returns {Array} 粒子数组
   */
  static createPointBurstParticles(x, y, options = {}) {
    const {
      count = 15,
      speed = 120,
      speedVariation = 0.8,
      angleSpread = Math.PI * 2,
      angleOffset = 0,
      distribution = DISTRIBUTION_TYPES.UNIFORM,
      innerRadius = 0,
      outerRadius = 0,
      particleParams = {},
      emit = true
    } = options;

    const particles = [];

    for (let i = 0; i < count; i++) {
      let angle, distance, finalSpeed;

      // 根据分布类型确定角度
      switch (distribution) {
        case DISTRIBUTION_TYPES.UNIFORM:
          angle = angleOffset + (i / count) * angleSpread;
          break;
        case DISTRIBUTION_TYPES.NORMAL:
          angle = angleOffset + this.normalRandom() * angleSpread * 0.3;
          break;
        case DISTRIBUTION_TYPES.RADIAL:
          angle = angleOffset + Math.random() * angleSpread;
          break;
        default:
          angle = angleOffset + Math.random() * angleSpread;
      }

      // 确定距离起点的距离
      distance = innerRadius + Math.random() * (outerRadius - innerRadius);
      
      // 确定速度
      finalSpeed = speed * (1 + (Math.random() - 0.5) * speedVariation);

      const startX = x + Math.cos(angle) * distance;
      const startY = y + Math.sin(angle) * distance;
      const vx = Math.cos(angle) * finalSpeed;
      const vy = Math.sin(angle) * finalSpeed;

      particles.push(this.createParticle({
        x: startX,
        y: startY,
        vx, vy,
        ...particleParams
      }));
    }

    if (emit) {
      this.emitParticles(particles);
    }

    return particles;
  }

  /**
   * 在 DOM 元素内以指定分布生成粒子
   * @param {HTMLElement|string} element - DOM 元素或选择器
   * @param {Object} options - 配置选项
   * @returns {Array} 粒子数组
   */
  static createAreaParticles(element, options = {}) {
    const {
      count = 25,
      distribution = DISTRIBUTION_TYPES.UNIFORM,
      speed = 50,
      speedVariation = 1.0,
      direction = 'random', // 'random', 'up', 'down', 'left', 'right', 'center', 'away'
      gridColumns = 5,
      gridRows = 5,
      spiralTurns = 2,
      clusterCount = 3,
      margin = 10,
      particleParams = {},
      emit = true
    } = options;

    // 获取 DOM 元素
    const domElement = typeof element === 'string' ? document.querySelector(element) : element;
    if (!domElement) {
      console.warn('ParticleHelper: Element not found');
      return [];
    }

    const rect = domElement.getBoundingClientRect();
    const effectiveWidth = rect.width - 2 * margin;
    const effectiveHeight = rect.height - 2 * margin;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const particles = [];

    for (let i = 0; i < count; i++) {
      let x, y, vx = 0, vy = 0;

      // 根据分布类型确定位置
      switch (distribution) {
        case DISTRIBUTION_TYPES.UNIFORM:
          x = rect.left + margin + Math.random() * effectiveWidth;
          y = rect.top + margin + Math.random() * effectiveHeight;
          break;

        case DISTRIBUTION_TYPES.NORMAL:
          x = rect.left + margin + this.normalRandom() * effectiveWidth * 0.3 + effectiveWidth * 0.5;
          y = rect.top + margin + this.normalRandom() * effectiveHeight * 0.3 + effectiveHeight * 0.5;
          x = Math.max(rect.left + margin, Math.min(rect.right - margin, x));
          y = Math.max(rect.top + margin, Math.min(rect.bottom - margin, y));
          break;

        case DISTRIBUTION_TYPES.GRID:
          const col = i % gridColumns;
          const row = Math.floor(i / gridColumns);
          x = rect.left + margin + (col / (gridColumns - 1)) * effectiveWidth;
          y = rect.top + margin + (row / (gridRows - 1)) * effectiveHeight;
          break;

        case DISTRIBUTION_TYPES.SPIRAL:
          const spiralT = i / count;
          const angle = spiralT * spiralTurns * Math.PI * 2;
          const radius = spiralT * Math.min(effectiveWidth, effectiveHeight) * 0.4;
          x = centerX + Math.cos(angle) * radius;
          y = centerY + Math.sin(angle) * radius;
          break;

        case DISTRIBUTION_TYPES.CLUSTER:
          const clusterIndex = Math.floor(Math.random() * clusterCount);
          const clusterX = rect.left + margin + (clusterIndex / (clusterCount - 1)) * effectiveWidth;
          const clusterY = rect.top + margin + Math.random() * effectiveHeight;
          const clusterRadius = Math.min(effectiveWidth, effectiveHeight) * 0.1;
          const clusterAngle = Math.random() * Math.PI * 2;
          const clusterDist = Math.random() * clusterRadius;
          x = clusterX + Math.cos(clusterAngle) * clusterDist;
          y = clusterY + Math.sin(clusterAngle) * clusterDist;
          break;

        case DISTRIBUTION_TYPES.EDGE:
          const edge = Math.floor(Math.random() * 4);
          const edgeT = Math.random();
          switch (edge) {
            case 0: // top
              x = rect.left + margin + edgeT * effectiveWidth;
              y = rect.top + margin;
              break;
            case 1: // right
              x = rect.right - margin;
              y = rect.top + margin + edgeT * effectiveHeight;
              break;
            case 2: // bottom
              x = rect.left + margin + edgeT * effectiveWidth;
              y = rect.bottom - margin;
              break;
            case 3: // left
              x = rect.left + margin;
              y = rect.top + margin + edgeT * effectiveHeight;
              break;
          }
          break;

        default:
          x = rect.left + margin + Math.random() * effectiveWidth;
          y = rect.top + margin + Math.random() * effectiveHeight;
      }

      // 根据方向确定速度
      const finalSpeed = speed * (1 + (Math.random() - 0.5) * speedVariation);
      
      switch (direction) {
        case 'up':
          vx = (Math.random() - 0.5) * finalSpeed * 0.3;
          vy = -finalSpeed;
          break;
        case 'down':
          vx = (Math.random() - 0.5) * finalSpeed * 0.3;
          vy = finalSpeed;
          break;
        case 'left':
          vx = -finalSpeed;
          vy = (Math.random() - 0.5) * finalSpeed * 0.3;
          break;
        case 'right':
          vx = finalSpeed;
          vy = (Math.random() - 0.5) * finalSpeed * 0.3;
          break;
        case 'center':
          const toCenterAngle = Math.atan2(centerY - y, centerX - x);
          vx = Math.cos(toCenterAngle) * finalSpeed;
          vy = Math.sin(toCenterAngle) * finalSpeed;
          break;
        case 'away':
          const fromCenterAngle = Math.atan2(y - centerY, x - centerX);
          vx = Math.cos(fromCenterAngle) * finalSpeed;
          vy = Math.sin(fromCenterAngle) * finalSpeed;
          break;
        case 'random':
        default:
          const randomAngle = Math.random() * Math.PI * 2;
          vx = Math.cos(randomAngle) * finalSpeed;
          vy = Math.sin(randomAngle) * finalSpeed;
      }

      particles.push(this.createParticle({
        x, y, vx, vy,
        ...particleParams
      }));
    }

    if (emit) {
      this.emitParticles(particles);
    }

    return particles;
  }

  /**
   * 创建彩虹粒子效果
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 配置选项
   */
  static createRainbowBurst(x, y, options = {}) {
    const rainbowColors = ['#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80', '#00ffff', '#0080ff', '#0000ff', '#8000ff', '#ff00ff', '#ff0080'];
    
    return this.createPointBurstParticles(x, y, {
      count: 12,
      speed: 100,
      ...options,
      particleParams: {
        life: 2000,
        size: 12,
        ...options.particleParams,
        color: (i) => rainbowColors[i % rainbowColors.length]
      }
    });
  }

  /**
   * 创建火花效果
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 配置选项
   */
  static createSparkEffect(x, y, options = {}) {
    const sparkColors = COLOR_PRESETS.FIRE;
    
    return this.createPointBurstParticles(x, y, {
      count: 8,
      speed: 150,
      speedVariation: 0.6,
      ...options,
      particleParams: {
        life: 800,
        size: 6,
        gravity: 100,
        drag: 0.8,
        ...options.particleParams,
        color: sparkColors[Math.floor(Math.random() * sparkColors.length)]
      }
    });
  }

  /**
   * 创建魔法光环效果
   * @param {HTMLElement|string} element - DOM 元素或选择器
   * @param {Object} options - 配置选项
   */
  static createMagicAura(element, options = {}) {
    const magicColors = COLOR_PRESETS.MAGIC;
    
    return this.createEdgeBurstParticles(element, {
      count: 15,
      speed: 30,
      angleSpread: Math.PI * 0.5,
      ...options,
      particleParams: {
        life: 3000,
        size: 10,
        gravity: -20,
        drag: 0.3,
        ...options.particleParams,
        color: magicColors[Math.floor(Math.random() * magicColors.length)]
      }
    });
  }

  /**
   * 批量发射粒子到 ParticleEffectManager
   * @param {Array} particles - 粒子数组
   */
  static emitParticles(particles) {
    // 处理颜色函数
    const processedParticles = particles.map((particle, index) => {
      if (typeof particle.color === 'function') {
        return {
          ...particle,
          color: particle.color(index)
        };
      }
      return particle;
    });

    frontendEventBus.emit('spawn-particles', processedParticles);
  }

  /**
   * 生成正态分布随机数
   * @returns {number} 正态分布随机数 (均值0，标准差1)
   */
  static normalRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random(); // 转换 [0,1) 到 (0,1)
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /**
   * 创建自定义轨迹函数：圆形轨迹
   * @param {number} radius - 半径
   * @param {number} angularSpeed - 角速度 (弧度/秒)
   * @param {number} centerX - 中心X
   * @param {number} centerY - 中心Y
   */
  static createCircularTrajectory(radius, angularSpeed, centerX, centerY) {
    return function(particle, deltaTime) {
      if (!particle.angle) particle.angle = 0;
      particle.angle += angularSpeed * deltaTime;
      particle.x = centerX + Math.cos(particle.angle) * radius;
      particle.y = centerY + Math.sin(particle.angle) * radius;
    };
  }

  /**
   * 创建自定义受力函数：向心力
   * @param {number} centerX - 中心X
   * @param {number} centerY - 中心Y
   * @param {number} strength - 力的强度
   */
  static createCentripetalForce(centerX, centerY, strength) {
    return function(particle, deltaTime) {
      const dx = centerX - particle.x;
      const dy = centerY - particle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > 0) {
        const force = strength / (distance * distance);
        return {
          x: (dx / distance) * force,
          y: (dy / distance) * force
        };
      }
      return { x: 0, y: 0 };
    };
  }

  /**
   * 创建自定义受力函数：风力
   * @param {number} windX - 风力X分量
   * @param {number} windY - 风力Y分量
   * @param {number} turbulence - 湍流强度
   */
  static createWindForce(windX, windY, turbulence = 0) {
    return function(particle, deltaTime) {
      const turbX = (Math.random() - 0.5) * turbulence;
      const turbY = (Math.random() - 0.5) * turbulence;
      return {
        x: windX + turbX,
        y: windY + turbY
      };
    };
  }
}

export default ParticleHelper;