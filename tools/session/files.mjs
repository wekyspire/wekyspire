// 会话文件层：tmp/playtests/<名>.json { seed, actions }。
// 只做读写与列举，不含对局逻辑；写入必须原子到「JSON 整体」级别
// （读侧 readSession 对半个文件返回 null，让轮询下个周期再试）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const sessionDir = path.join(ROOT, 'tmp', 'playtests');
export const sessionPath = (name) => path.join(sessionDir, `${name}.json`);

export function listSessions() {
  if (!fs.existsSync(sessionDir)) return [];
  return fs.readdirSync(sessionDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
}

export function readSession(name) {
  const file = sessionPath(name);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // save/saveName：`load <存档>` 建的会话带内嵌快照——消费方（headlessPlay / broadcast）
    // 必须照原样重建，否则会把会话当"从零开局"重放、状态与动作全部错位。
    return {
      seed: data.seed,
      save: data.save ?? null,
      saveName: data.saveName ?? null,
      actions: Array.isArray(data.actions) ? data.actions : [],
    };
  } catch { return null; } // 写入中途的半个文件：让调用方下个轮询再试
}

export function writeSession(name, data) {
  fs.mkdirSync(sessionDir, { recursive: true });
  // 原子写（tmp+rename）：读侧不再可能拿到半个文件
  const tmpFile = `${sessionPath(name)}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  // Windows 上 rename 偶发 EPERM/EBUSY/EACCES（杀毒/索引器瞬时锁，试玩实报：tmp 目录
  // 成堆孤儿 .tmp-<pid> 即此路径命中锁的遗留）——退避重试，退避总窗 ~1.8s 覆盖常见
  // AV 扫描时长；重试不污染状态（tmp 按 pid 命名，重写同一路径）。全部失败时清掉孤儿 tmp。
  let lastErr = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.renameSync(tmpFile, sessionPath(name));
      return;
    } catch (e) {
      lastErr = e;
      if (e?.code !== 'EPERM' && e?.code !== 'EBUSY' && e?.code !== 'EACCES') throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
  try { fs.unlinkSync(tmpFile); } catch { /* 清理失败无关紧要 */ }
  throw lastErr;
}
