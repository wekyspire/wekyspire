// 前端事件总线
// 前端事件总线负责在前端组件之间传递事件和数据，一般用于控制和播放动画，不涉及具体结算逻辑
import mitt from 'mitt';

const frontendEventBus = mitt();

export default frontendEventBus;

