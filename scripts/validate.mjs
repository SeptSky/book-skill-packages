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
 *   6. zip 可解压；解压前预扫描条目名（拒绝 ..、绝对路径、反斜杠、符号链接）——
 *      系统 unzip 整体解压后再检查无法防写入型穿越，必须预扫描
 *   7. 解压后 SKILL.md 存在，frontmatter 的 id/name/description 与 manifest 一致
 *      （不比对 version——SKILL.md 的 version 是知识图谱 schema 版本，固定 "2.0"）
 *   8. entities.json / relations.json 存在且为合法 JSON（v2.0 包装或裸数组）
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

/** 轻量解析 SKILL.md frontmatter（仅支持 `key: "value"` 行） */
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = text.slice(3, end);
  const out = {};
  for (const line of block.split("\n")) {
    const m = /^([a-zA-Z_]+):\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/\\"/g, '"');
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
    if (entry.split("/").includes("..")) {
      fail(`zip 条目含路径穿越（..）：${entry}`);
      return;
    }
    if (entry.startsWith("/") || entry.includes("\\")) {
      fail(`zip 条目含绝对路径或反斜杠：${entry}`);
      return;
    }
  }

  // 解压到临时目录
  const tmp = mkdtempSync(join(tmpdir(), "skillpkg-"));
  try {
    execFileSync("unzip", ["-q", "-o", zipFile, "-d", tmp]);
  } catch (e) {
    fail(`zip 解压失败：${e.message.trim()}`);
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
  if (fm.id !== manifest.id) {
    fail(`SKILL.md frontmatter 的 id（${fm.id}）与 manifest（${manifest.id}）不一致`);
  }
  if (fm.name !== manifest.name) {
    fail(`SKILL.md frontmatter 的 name（${fm.name}）与 manifest（${manifest.name}）不一致`);
  }
  const descMatches = [manifest.description.zh, manifest.description.en].includes(fm.description);
  if (!descMatches) {
    fail("SKILL.md frontmatter 的 description 与 manifest（zh/en）均不一致");
  }
  // 不比对 version：SKILL.md 的 version 是知识图谱 schema 版本（固定 "2.0"），与包版本无关

  // entities.json / relations.json
  const entities = tryReadJson(join(tmp, "entities.json"), "entities.json");
  if (entities !== null) {
    const arr = Array.isArray(entities) ? entities : entities.entities;
    if (!Array.isArray(arr)) fail("entities.json 须为裸数组或 { entities: [...] }");
  }
  const relations = tryReadJson(join(tmp, "relations.json"), "relations.json");
  if (relations !== null) {
    const arr = Array.isArray(relations) ? relations : relations.relations;
    if (!Array.isArray(arr)) fail("relations.json 须为裸数组或 { relations: [...] }");
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
