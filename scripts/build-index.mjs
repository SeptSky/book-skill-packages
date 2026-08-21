#!/usr/bin/env node
/**
 * build-index.mjs — 生成仓库根目录 index.json（零第三方依赖）
 *
 * 用法：node scripts/build-index.mjs
 *
 * 遍历 packages 下各包的 manifest.json，生成确定性索引（按 id 排序，2 空格缩进）。
 * 字段对齐消费端 CatalogPackage（KTD4）：
 *   id / title{zh,en} / description{zh,en} / currentVersion / downloadUrl / language
 *
 * downloadUrl 推导：
 *   https://github.com/{owner}/{repo}/releases/download/{id}@{version}/{zip}
 * owner/repo 解析顺序：
 *   1. 环境变量 GITHUB_REPOSITORY（GitHub Actions 自动注入，release.yml 使用）
 *   2. git remote origin URL
 *   3. 占位符 "{owner}/{repo}" + 告警（本地预览用）
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, sep, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const OUT_FILE = join(ROOT, "index.json");

function resolveRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    if (url) {
      // 支持 git@github.com:o/r.git 与 https://github.com/o/r(.git)
      const m = /(?:github\.com[:/])([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
      if (m) return `${m[1]}/${m[2]}`;
    }
  } catch {
    // 无 remote
  }
  console.warn("[WARN] 未解析到 owner/repo（无 GITHUB_REPOSITORY 且无 remote），downloadUrl 使用占位符");
  return "{owner}/{repo}";
}

function buildIndex() {
  const repo = resolveRepo();
  const entries = [];

  if (!existsSync(PACKAGES_DIR)) return entries;
  for (const name of readdirSync(PACKAGES_DIR)) {
    const pkgDir = join(PACKAGES_DIR, name);
    const manifestFile = join(pkgDir, "manifest.json");
    if (!existsSync(manifestFile)) continue; // 跳过 .gitkeep 等

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    } catch (e) {
      console.error(`[SKIP] ${name}: manifest 解析失败（${e.message}）——先跑 validate.mjs`);
      continue;
    }

    const { id, version, title, description, language, zip } = manifest;
    if (!id || !version) {
      console.error(`[SKIP] ${name}: manifest 缺 id/version`);
      continue;
    }
    entries.push({
      id,
      title,
      description,
      currentVersion: version,
      downloadUrl: `https://github.com/${repo}/releases/download/${id}@${version}/${zip ?? `${id}-${version}.zip`}`,
      language,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

const entries = buildIndex();
const output = `${JSON.stringify(entries, null, 2)}\n`;
writeFileSync(OUT_FILE, output, "utf8");
console.log(`[OK] index.json 已生成：${entries.length} 个包`);
console.log(output);
