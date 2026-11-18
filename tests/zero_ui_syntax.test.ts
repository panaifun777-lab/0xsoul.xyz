/**
 * 校验 ZERO_UI_HTML / DOCS_UI_HTML 内联 <script> 是合法浏览器 JS。
 * 关键：模板字符串里若混入 TS 类型注解（如 `let x: any`），tsx 能编译但浏览器会整段报语法错，
 * 导致中英文切换 / 实时数据 / 确认面板全部失效。此测试用 node --check 抓这类回归。
 */
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { ZERO_UI_HTML, DOCS_UI_HTML } from '../src/gateway/zero_ui';

function extractInline(html: string): string {
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  return blocks
    .map((b) => b.replace(/^<script>/, '').replace(/<\/script>$/, ''))
    .filter((x) => x.trim().length > 0)
    .join('\n;\n');
}

let failed = false;
for (const [name, html] of [['ZERO_UI_HTML', ZERO_UI_HTML], ['DOCS_UI_HTML', DOCS_UI_HTML]] as const) {
  const js = extractInline(html);
  if (!js) { console.log(`${name}: no inline script, skip`); continue; }
  const tmp = `.tmp_${name}.js`;
  writeFileSync(tmp, js);
  try {
    execSync(`node --check ${tmp}`, { stdio: 'pipe' });
    console.log(`${name}: inline JS syntax OK (${js.length} chars)`);
  } catch (e: any) {
    failed = true;
    console.error(`${name}: INLINE JS SYNTAX ERROR\n${e.stderr?.toString() || e.message}`);
  } finally {
    unlinkSync(tmp);
  }
}

// i18n 完整性：data-en 不能是中文；带 placeholder 的元素必须有 data-en-placeholder。
const cjk = /[\u4e00-\u9fff]/;
const dataEnValues = [...ZERO_UI_HTML.matchAll(/data-en="([^"]*)"/g)].map((m) => m[1]);
const badEn = dataEnValues.filter((v) => cjk.test(v));
const placeholders = [...ZERO_UI_HTML.matchAll(/<input[^>]*placeholder="([^"]*)"[^>]*>/g)].map((m) => m[0]);
const missingPh = placeholders.filter((tag) => !tag.includes('data-en-placeholder'));

if (badEn.length) {
  failed = true;
  console.error(`i18n: ${badEn.length} data-en values still contain Chinese:`, badEn.slice(0, 10));
} else {
  console.log(`i18n: all ${dataEnValues.length} data-en values are English`);
}
if (missingPh.length) {
  failed = true;
  console.error(`i18n: ${missingPh.length} inputs missing data-en-placeholder`);
} else {
  console.log(`i18n: all ${placeholders.length} inputs have data-en-placeholder`);
}

if (failed) process.exit(1);
console.log('ALL INLINE SCRIPTS VALID + I18N COMPLETE');
