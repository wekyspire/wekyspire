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
    return { seed: data.seed, actions: Array.isArray(data.actions) ? data.actions : [] };
  } catch { return null; } // 写入中途的半个文件：让调用方下个轮询再试
}

export function writeSession(name, data) {
  fs.mkdirSync(sessionDir, { recursive: true });
  // 原子写（tmp+rename）：读侧不再可能拿到半个文件
  const tmpFile = `${sessionPath(name)}.tmp-${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, sessionPath(name));
}
