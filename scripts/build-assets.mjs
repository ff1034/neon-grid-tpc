// 部署前把遊戲網頁需要的檔案複製到 dist/，Cloudflare 只上傳 dist/（wrangler.toml 的 [build] 會自動執行這支）。
// 這樣 node_modules、.wrangler、blender 這些東西永遠不會被當成網頁資源上傳（Workers 單檔上限 25 MB）。
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const ITEMS = ['index.html', 'src', 'vendor', 'models'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ITEMS) {
  const from = join(root, item);
  if (!existsSync(from)) { console.error(`缺少 ${item}，請確認它有上傳到 GitHub`); process.exit(1); }
  cpSync(from, join(out, item), { recursive: true });
}
console.log(`已把 ${ITEMS.join('、')} 複製到 dist/`);
