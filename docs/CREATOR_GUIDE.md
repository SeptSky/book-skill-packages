# Creator 制作打包指引（CREATOR_GUIDE）

本文档说明如何用 AI Reader X Creator 制作技能包并导出符合本仓库规范的 zip，保证产出物可直接通过 CI 校验（`validate.mjs`）。

## 1. 准备素材

- 章节文本（markdown 或纯文本）
- 原文章节（可选，用于对照阅读）
- 实体与关系由 Creator 从章节提炼（或手动构建）

> **版权自检（投稿前必做）**：确认内容版权状态——公版作品、CC 许可或已获授权。基于个人购买书籍制作的提炼包一律不允许分发。

## 2. 在 Creator 中制作

1. 新建/打开技能包项目
2. 添加章节素材（`chapters`）
3. 构建知识图谱：提炼实体（entities）与关系（relations），系统会自动生成 `entities.json` / `relations.json`（v2.0 格式）
4. 填写元数据：名称、描述、作者
5. 可选：生成编译产物（核心、章节索引、术语表、模式、速查表）

## 3. 导出 zip

1. 在 Creator 中执行导出
2. 得到 zip 文件，内部结构应包含：
   - `SKILL.md`（frontmatter：`id`、`name`、`description`、`author`（可选）、`version: "2.0"`）
   - `entities.json`、`relations.json`
   - `chapters/chapter_1.md`、`chapters/chapter_2.md`、…
   - `original_chapters/`（如有）
   - 编译产物（如有）

## 4. 体积控制（重要）

- **zip 必须 ≤ 50MB**（CI 校验硬限；git 单文件 100MB 限制远大于此，实际约束在 CI 侧）。
- 超出时优先压缩图片（降低分辨率/转 WebP）、再考虑缩小章节范围。
- 提交前检查：

```bash
ls -lh your-package.zip   # 确认 ≤ 50MB
```

## 5. 准备 manifest.json

按 [PACKAGE_SPEC](./PACKAGE_SPEC.md) §2 编写 `manifest.json`，关键点：

- `id`：小写 slug（`[a-z0-9-]`），如 `hongloumeng`
- `version`：包版本 semver（如 `1.0.0`），**与 SKILL.md 的 `version: "2.0"` 无关**（后者是知识图谱 schema 版本）
- `zip`：`<id>-<version>.zip`，与导出的 zip 文件名一致
- `copyright.status`：`public_domain` / `cc` / `licensed` 之一，并填 `notice`

## 6. 投稿前本地自检

本地有 Node 18+ 时，可先跑校验脚本（本仓库根目录）：

```bash
node scripts/validate.mjs packages/<id>
```

通过后再发起 PR（流程见 [CONTRIBUTING](../CONTRIBUTING.md)）。

## 常见错误

| 错误 | 原因 | 修复 |
|---|---|---|
| `id` 格式非法 | 含大写/下划线/中文 | 改为小写 slug |
| `version` 非 semver | 如 `2.0`、`v1.0` | 改为 `1.0.0` |
| `copyright.status` 非法 | 不在枚举内 | 改为 `public_domain`/`cc`/`licensed` |
| zip 超限 | 资源过大 | 压缩图片或缩小范围 |
| SKILL.md 与 manifest 不一致 | 导出后改了包名 | 保持两者 `id`/`name`/`description` 一致 |
