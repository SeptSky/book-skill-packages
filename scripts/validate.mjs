#!/usr/bin/env node
/**
 * validate.mjs — 技能包校验脚本（零第三方依赖）
 *
 * 用法：
 *   node scripts/validate.mjs                # 校验 packages/* 下所有包
 *   node scripts/validate.mjs packages/<id>  # 校验单个包
 *
 * 退出码：0 = 全部通过；1 = 任一失败。错误逐条输出 [FAIL]。
 *
 * 校验项（见 docs/PACKAGE_SPEC.md）：
 *   1. manifest 合法 JSON 且必填字段齐全
 *   2. id 为小写 slug（[a-z0-9-]，3-64，首尾非 -）
 *   3. version 为 semver
 *   4. copyright.status ∈ {public_domain, cc, licensed}
 *   5. zip 文件存在、命名 <id>-<version>.zip、≤ 50MB
 *   6. zip 可解压；解压前预扫描条目名：反斜杠规范化为 /（Windows 打包器产物）、检测并
 *      剥离单层顶层包装前缀（对齐 extractor.rs 的 detect_wrapping_prefix），拒绝 ..、
 *      绝对路径、符号链接（系统 unzip 整体解压后再检查无法防写入型穿越，必须预扫描）；
 *      解压用系统 python3 标准库 zipfile（Linux unzip 不把反斜杠当分隔符，无法正确落盘）
 *   7. 解压后 SKILL.md 存在；frontmatter 的 id（若存在，须匹配 manifest.id 或 name 之一）与
 *      name 与 manifest 一致（不比对 version——SKILL.md 的 version 是知识图谱 schema 版本，固定 "2.0"）
 *   8. entities.json / relations.json（根级或 knowledge_graph/ 子目录）存在且为合法 JSON（v2.0 包装或裸数组）
 *   9. 资源上限：解压后总量 ≤ 200MB、单 JSON ≤ 50MB（防 zip 炸弹）
 *   10. 解压产物中无符号链接
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

// ---- 资源上限常量（与 docs/PACKAGE_SPEC.md 保持一致）----
const MAX_ZIP_BYTES = 50 * 1024 * 1024;        // zip ≤ 50MB（CI 校验硬限）
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;     // 解压后总量 ≤ 200MB（防 zip 炸弹）
const MAX_JSON_BYTES = 50 * 1024 * 1024;       // 单 JSON ≤ 50MB

const COPYRIGHT_STATUSES = new Set(["public_domain", "cc", "licensed"]);
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ID_RE = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/; // 3-64 字符，首尾非 "-"

/**
 * 安全解压脚本（系统 python3 标准库 zipfile，零 npm 依赖）：
 *  - 反斜杠规范化为 /（Windows 打包器产物，对齐 extractor.rs）
 *  - 跳过 __MACOSX / 隐藏文件条目（extractor.rs 同款过滤）
 *  - 安全拒绝：绝对路径（/ 或盘符开头）、.. 路径段（双保险，Node 预扫描已查一次）
 *  - 检测单层顶层包装前缀（detect_wrapping_prefix 移植）：仅当所有条目共享
 *    同一顶层目录时剥离（如 "pkg/SKILL.md" → "SKILL.md"）
 *  - 符号链接条目按普通文件内容落盘，不创建链接（与 Rust zip crate 行为一致）
 */
const PY_EXTRACT = String.raw`
import sys, os, zipfile
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
def clean(raw):
    n = raw.replace('\\', '/')
    if '__MACOSX' in n or n.startswith('.') or '/.' in n:
        return None
    return n
with zipfile.ZipFile(src) as z:
    infos = z.infolist()
    norm = []
    for it in infos:
        n = clean(it.filename)
        if n is None:
            continue
        if n.startswith('/') or n.startswith('C:') or n.startswith('c:'):
            sys.exit('absolute path entry: ' + n)
        if any(seg == '..' for seg in n.split('/')):
            sys.exit('path traversal entry: ' + n)
        norm.append(n)
    # detect_wrapping_prefix：所有条目在同一顶层目录时才剥离
    prefix = None
    if norm and all('/' in n for n in norm):
        firsts = [n.split('/')[0] for n in norm]
        f0 = firsts[0]
        if f0 and '.' not in f0 and all(f == f0 for f in firsts):
            prefix = f0 + '/'
    for it in infos:
        n = clean(it.filename)
        if n is None:
            continue
        if prefix and n.startswith(prefix):
            n = n[len(prefix):]
        out = os.path.join(dst, n)
        if it.is_dir():
            os.makedirs(out, exist_ok=True)
        else:
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, 'wb') as f:
                f.write(z.read(it.filename))
`;

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

/** 浅读 JSON，失败时返回 null 并记录错误 */
function tryReadJson(file, label) {
  try {
    const raw = readFileSync(file, "utf8");
    if (Buffer.byteLength(raw) > MAX_JSON_BYTES) {
      fail(`${label} 超过单文件大小上限（50MB）`);
      return null;
    }
    return JSON.parse(raw);
  } catch (e) {
    fail(`${label} 不是合法 JSON：${e.message}`);
    return null;
  }
}

/** 找到未转义闭合引号的位置；无则返回 -1 */
function findClosingQuote(s) {
  let escaped = false;
  for (let j = 0; j < s.length; j++) {
    const ch = s[j];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') return j;
  }
  return -1;
}

/** 轻量解析 SKILL.md frontmatter（支持单行与多行双引号字符串值） */
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = text.slice(3, end);
  const lines = block.split("\n");
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^([a-zA-Z_]+):\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line.trim());
    if (m) {
      out[m[1]] = m[2].replace(/\\"/g, '"');
      i++;
      continue;
    }
    // 多行字符串值：`key: "..."` 跨行直至未转义闭合引号（真实导出器格式）
    const start = /^([a-zA-Z_]+):\s*"/.exec(line.trim());
    if (start) {
      const key = start[1];
      let val = line.slice(line.indexOf('"') + 1);
      const closed = findClosingQuote(val);
      if (closed >= 0) {
        out[key] = val.slice(0, closed).replace(/\\"/g, '"');
        i++;
        continue;
      }
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const c = findClosingQuote(l);
        if (c >= 0) {
          val += "\n" + l.slice(0, c);
          break;
        }
        val += "\n" + l;
        i++;
      }
      out[key] = val.replace(/\\"/g, '"');
      i++;
      continue;
    }
    // 裸值（无引号）：`key: value`，如 `name: hoang-bayesian-games`
    const bare = /^([a-zA-Z_]+):\s*(\S.*)$/.exec(line.trim());
    if (bare) {
      out[bare[1]] = bare[2].trim();
      i++;
      continue;
    }
    i++;
  }
  return out;
}

/** 校验 manifest.json */
function validateManifest(dir) {
  const manifestFile = join(dir, "manifest.json");
  if (!existsSync(manifestFile)) {
    fail("缺少 manifest.json");
    return null;
  }
  const manifest = tryReadJson(manifestFile, "manifest.json");
  if (!manifest) return null;
  if (typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("manifest.json 必须是 JSON 对象");
    return null;
  }

  const required = ["id", "version", "name", "title", "description", "language", "copyright", "zip"];
  for (const key of required) {
    if (!(key in manifest) || manifest[key] === "" || manifest[key] === null) {
      fail(`manifest 缺少必填字段: ${key}`);
      return null;
    }
  }

  if (typeof manifest.id !== "string" || !ID_RE.test(manifest.id) || manifest.id.length < 3 || manifest.id.length > 64) {
    fail(`id 非法（需小写 slug，3-64 字符，仅 [a-z0-9-]）：${manifest.id}`);
  }
  if (typeof manifest.version !== "string" || !SEMVER_RE.test(manifest.version)) {
    fail(`version 非法（需 semver）：${manifest.version}`);
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    fail("name 必须为非空字符串");
  }
  for (const lang of ["zh", "en"]) {
    if (typeof manifest.title?.[lang] !== "string" || !manifest.title[lang].trim()) {
      fail(`title.${lang} 必须为非空字符串`);
    }
    if (typeof manifest.description?.[lang] !== "string" || !manifest.description[lang].trim()) {
      fail(`description.${lang} 必须为非空字符串`);
    }
  }
  if (typeof manifest.language !== "string" || !manifest.language.trim()) {
    fail("language 必须为非空字符串");
  }
  if (!COPYRIGHT_STATUSES.has(manifest.copyright?.status)) {
    fail(`copyright.status 非法（须为 ${[...COPYRIGHT_STATUSES].join("/")}）：${manifest.copyright?.status}`);
  }
  if (typeof manifest.copyright?.notice !== "string" || !manifest.copyright.notice.trim()) {
    fail("copyright.notice 必须为非空字符串");
  }
  if (manifest.author !== undefined && (typeof manifest.author !== "string" || !manifest.author.trim())) {
    fail("author 若提供必须为非空字符串");
  }

  const expectedZip = `${manifest.id}-${manifest.version}.zip`;
  if (manifest.zip !== expectedZip) {
    fail(`zip 文件名必须为 <id>-<version>.zip，期望 ${expectedZip}，实际 ${manifest.zip}`);
  }
  if (!existsSync(join(dir, manifest.zip))) {
    fail(`zip 文件不存在：${manifest.zip}`);
  }

  return manifest;
}

/** 校验 zip：体积、预扫描条目、解压、内容一致性 */
function validateZip(dir, manifest) {
  const zipFile = join(dir, manifest.zip);
  const size = statSync(zipFile).size;
  if (size > MAX_ZIP_BYTES) {
    fail(`zip 超过 50MB 上限（${(size / 1024 / 1024).toFixed(1)}MB）`);
    return;
  }

  // 预扫描：枚举条目名，不落盘（unzip -Z1 只列文件名）
  let entries;
  try {
    entries = execFileSync("unzip", ["-Z1", zipFile], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) {
    fail(`zip 无法读取条目（损坏？）：${e.message.trim()}`);
    return;
  }
  if (entries.length === 0) {
    fail("zip 为空");
    return;
  }

  for (const entry of entries) {
    // 反斜杠是 Windows 打包器的路径分隔符，规范化为 / 后再检查（对齐 extractor.rs）
    const norm = entry.replace(/\\/g, "/");
    if (norm.split("/").includes("..")) {
      fail(`zip 条目含路径穿越（..）：${entry}`);
      return;
    }
    if (norm.startsWith("/") || /^[A-Za-z]:\//.test(norm)) {
      fail(`zip 条目含绝对路径：${entry}`);
      return;
    }
  }

  // 解压到临时目录（python3 zipfile：反斜杠规范化 + 剥离单层顶层包装前缀 + 安全落盘）
  const tmp = mkdtempSync(join(tmpdir(), "skillpkg-"));
  try {
    execFileSync("python3", ["-c", PY_EXTRACT, zipFile, tmp], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (e) {
    const msg = (e.stderr || e.message).toString().trim();
    fail(`zip 解压失败：${msg}`);
    return;
  }

  // 解压后资源与符号链接检查（递归）
  let total = 0;
  let hasSymlink = false;
  const allFiles = [];
  (function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        hasSymlink = true;
        continue;
      }
      if (st.isDirectory()) {
        walk(p);
      } else {
        allFiles.push(p);
        total += st.size;
      }
    }
  })(tmp);
  if (hasSymlink) {
    fail("zip 解压产物含符号链接（已拒绝）");
    return;
  }
  if (total > MAX_TOTAL_BYTES) {
    fail(`zip 解压后总量超过 200MB 上限（${(total / 1024 / 1024).toFixed(1)}MB）`);
    return;
  }

  // SKILL.md
  const skillFile = join(tmp, "SKILL.md");
  if (!existsSync(skillFile)) {
    fail("zip 缺少 SKILL.md");
    return;
  }
  const fm = parseFrontmatter(readFileSync(skillFile, "utf8"));
  // 导出器写入的 frontmatter id 是"包内 id"（常为中文书名），与 manifest 的仓库 slug 概念不同；
  // 因此仅当 id 存在时校验，且匹配 manifest.id 或 name 之一即可（防错包同时兼容真实导出格式）。
  if (fm.id !== undefined && ![manifest.id, manifest.name].includes(fm.id)) {
    fail(`SKILL.md frontmatter 的 id（${fm.id}）与 manifest（id=${manifest.id}, name=${manifest.name}）均不一致`);
  }
  if (fm.name !== manifest.name) {
    fail(`SKILL.md frontmatter 的 name（${fm.name}）与 manifest（${manifest.name}）不一致`);
  }
  const descMatches = [manifest.description.zh, manifest.description.en].includes(fm.description);
  if (!descMatches) {
    fail("SKILL.md frontmatter 的 description 与 manifest（zh/en）均不一致");
  }
  // 不比对 version：SKILL.md 的 version 是知识图谱 schema 版本（固定 "2.0"），与包版本无关

  // entities.json / relations.json（兼容根级与 knowledge_graph/ 子目录两代导出格式）
  const findJson = (name) => {
    const root = join(tmp, name);
    if (existsSync(root)) return root;
    const kg = join(tmp, "knowledge_graph", name);
    return existsSync(kg) ? kg : null;
  };
  for (const [name, key] of [["entities.json", "entities"], ["relations.json", "relations"]]) {
    const file = findJson(name);
    if (!file) {
      fail(`zip 缺少 ${name}（根级或 knowledge_graph/ 子目录）`);
      continue;
    }
    const data = tryReadJson(file, name);
    if (data !== null) {
      const arr = Array.isArray(data) ? data : data[key];
      if (!Array.isArray(arr)) fail(`${name} 须为裸数组或 { ${key}: [...] }`);
    }
  }

  if (errors.length === 0) warn(`解压 ${entries.length} 个条目，共 ${(total / 1024 / 1024).toFixed(1)}MB`);
  return tmp; // 由调用方清理
}

function validatePackage(pkgDir, explicit = false) {
  const id = pkgDir.split(sep).pop();
  if (!existsSync(join(pkgDir, "manifest.json"))) {
    // 遍历模式跳过无 manifest 的目录（如 .gitkeep）；显式指定则必须报错
    if (explicit) fail(`目录不含 manifest.json：${pkgDir}`);
    return;
  }
  const before = errors.length;
  const manifest = validateManifest(pkgDir);
  if (!manifest) return;
  const tmp = validateZip(pkgDir, manifest);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (errors.length === before) {
    console.log(`[OK] ${id}@${manifest.version}`);
  } else {
    console.log(`[FAIL] ${id}`);
  }
}

// ---- main ----
const arg = process.argv[2];
if (arg) {
  validatePackage(resolve(arg), true);
} else {
  if (!existsSync(PACKAGES_DIR)) {
    console.error("缺少 packages/ 目录");
    process.exit(1);
  }
  for (const name of readdirSync(PACKAGES_DIR)) {
    const p = join(PACKAGES_DIR, name);
    if (statSync(p).isDirectory()) validatePackage(p);
  }
}

for (const w of warnings) console.log(`[WARN] ${w}`);
for (const e of errors) console.log(`[FAIL] ${e}`);
if (errors.length > 0) process.exit(1);
console.log(errors.length === 0 && !arg ? "" : "");
