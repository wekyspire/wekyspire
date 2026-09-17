// 天空穹顶点着色器（towerWilderness）——传局部坐标给片元做渐变
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
