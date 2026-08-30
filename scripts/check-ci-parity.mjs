// 比对 .cnb.yml 的 ifModify 取反列表与 .github/workflows/ci.yml 的 paths-ignore。
//
// 两边的排除列表本应等价，任一侧漏改都会造成两套 CI 行为不一致。
// 采用纯文本解析、零依赖：不引入 YAML 库，也不依赖任何本地绝对路径。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 从 .cnb.yml 中取出 push 流水线的 ifModify 列表。 */
function readCnbIfModify() {
    const text = fs.readFileSync(path.join(ROOT, '.cnb.yml'), 'utf8');

    // 定位 push 事件下的 ifModify 块（该列表以 `ifModify: *ci-ifmodify` 或
    // 内联数组两种形式出现，这里只处理当前配置使用的锚点引用形式）。
    const anchorBlock = /^\.ci-ifmodify:\s*&ci-ifmodify\s*\n((?:\s*-\s*"[^"]*"\s*\n)+)/m.exec(text);
    if (anchorBlock) {
        return [...anchorBlock[1].matchAll(/-\s*"([^"]*)"/g)].map((m) => m[1]);
    }

    const inline = /ifModify:\s*\n((?:\s*-\s*"[^"]*"\s*\n)+)/.exec(text);
    if (inline) {
        return [...inline[1].matchAll(/-\s*"([^"]*)"/g)].map((m) => m[1]);
    }

    throw new Error('未能从 .cnb.yml 解析出 ifModify 列表');
}

/** 从 GitHub workflow 中取出 push.paths-ignore 列表。 */
function readGithubPathsIgnore() {
    const text = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    // 列表项之间允许存在注释与空行，故用非贪婪匹配到下一个同缩进或更浅的键为止。
    const block = /paths-ignore:\s*\n((?:[ \t]*(?:#.*)?\n|[ \t]*-\s*'[^']*'\s*\n)+)/.exec(text);
    if (!block) throw new Error('未能从 ci.yml 解析出 paths-ignore 列表');
    return [...block[1].matchAll(/-\s*'([^']*)'/g)].map((m) => m[1]);
}

// "!(**/*.md)" -> "**/*.md"；"!*.md" -> "*.md"；丢弃打底的 "**"
const cnbList = readCnbIfModify()
    .filter((x) => x.startsWith('!'))
    .map((x) => x.replace(/^!/, '').replace(/^\((.*)\)$/, '$1'))
    .sort();

const ghList = readGithubPathsIgnore().sort();

console.log('CNB  ifModify 排除项：');
cnbList.forEach((x) => console.log('   ', x));
console.log('GitHub paths-ignore 排除项：');
ghList.forEach((x) => console.log('   ', x));

const same = JSON.stringify(cnbList) === JSON.stringify(ghList);
console.log(same ? '\n✓ 两边等价' : '\n✗ 不一致');

if (!same) {
    console.log('仅 CNB 有：', cnbList.filter((x) => !ghList.includes(x)));
    console.log('仅 GH  有：', ghList.filter((x) => !cnbList.includes(x)));
    process.exit(1);
}
