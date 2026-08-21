# 技能包仓库规范（PACKAGE_SPEC）

本文档定义本仓库技能包投稿的目录结构、manifest 字段、zip 交付与版权合规要求。投稿前必读。

## 1. 目录结构

```
packages/
└── <id>/
    ├── manifest.json          # 元数据（必填）
    └── <id>-<version>.zip     # 技能包 zip（PR 暂态文件，发布后清理）
```

- `<id>`：包 ID，见 §2 字段规范。
- zip 文件名必须为 `<id>-<version>.zip`，与 manifest 中 `zip` 字段一致。
- 每个包一个独立目录，互不嵌套。

## 2. manifest 字段规范

`manifest.json` 为 UTF-8 JSON 对象，字段如下：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 包 ID。小写 slug，仅允许 `[a-z0-9-]`，首尾不得为 `-`，长度 3-64 |
| `version` | string | 是 | 包版本，semver（`MAJOR.MINOR.PATCH`） |
| `name` | string | 是 | 包名（原语名称，与 `SKILL.md` frontmatter 的 `name` 一致） |
| `title` | object | 是 | `{"zh": "中文标题", "en": "English title"}`，两语言均必填 |
| `description` | object | 是 | `{"zh": "中文简介", "en": "English description"}`，两语言均必填 |
| `author` | string | 否 | 作者名 |
| `language` | string | 是 | 内容语言代码，如 `zh`、`en` |
| `source` | string | 否 | 内容来源说明（公版书目、CC 链接等） |
| `copyright` | object | 是 | 版权声明，见 §3 |
| `zip` | string | 是 | zip 文件名，必须为 `<id>-<version>.zip` |

### 完整示例

```json
{
  "id": "hongloumeng",
  "version": "1.0.0",
  "name": "红楼梦",
  "title": { "zh": "红楼梦（AI 导读版）", "en": "Dream of the Red Chamber" },
  "description": {
    "zh": "以知识图谱组织的《红楼梦》导读技能包，含主要人物关系与情节脉络。",
    "en": "A knowledge-graph guided tour of Dream of the Red Chamber."
  },
  "author": "ai-reader-x 团队",
  "language": "zh",
  "source": "公版书（人民文学出版社校注本已过期版权）",
  "copyright": {
    "status": "public_domain",
    "notice": "原著为公版作品"
  },
  "zip": "hongloumeng-1.0.0.zip"
}
```

### 错误示例

```json
{
  "id": "红楼梦",              // 错：非小写 slug
  "version": "2.0",            // 错：语义为知识图谱 schema 版本，非包版本
  "title": { "zh": "只填中文" } // 错：en 缺失
}
```

## 3. 版权合规

`copyright.status` 枚举（仅此三类）：

| 值 | 含义 | 要求 |
|---|---|---|
| `public_domain` | 公版作品 | `notice` 说明公版依据（如「原著为公版作品」） |
| `cc` | 知识共享许可 | `notice` 注明具体许可（如 `CC BY 4.0`） |
| `licensed` | 已获授权 | `notice` 注明授权情况 |

**版权红线（不可逾越）**：

- 基于个人购买书籍制作的提炼包一律**不允许**分发入库——无论改写程度如何。
- 校验只做声明检查（枚举合法性），不验证内容；合规依赖贡献者自律与维护者审查。
- 维护者保留对不合规包的无理由移除权。

## 4. zip 交付与校验

- zip 为 PR 暂态文件：随 PR 提交，发布后由工作流清理，**不长期进入仓库**（保持仓库轻量）。
- zip 内部结构（AI Reader X 导出格式）：
  - `SKILL.md` — frontmatter 含 `id`、`name`、`description`、`author`（可选）、`version`（固定 `"2.0"`，知识图谱 schema 版本，**与 manifest.version 无关**）
  - `entities.json` / `relations.json` — v2.0 包装或裸数组
  - `chapters/chapter_N.md`、`original_chapters/chapter_N.md`
  - 编译产物可选（`core.md`、`chapter_index.md`、`glossary.md`、`patterns.md`、`cheatsheet.md`）
- 校验项（CI 自动执行，见 `scripts/validate.mjs`）：
  - manifest 合法、必填字段齐全
  - `id` slug 格式、`version` semver
  - `copyright.status` ∈ 枚举
  - zip 可解压、≤50MB、无路径穿越（预扫描拒绝 `..`/绝对路径/反斜杠/符号链接）
  - `SKILL.md` 的 `id`/`name`/`description` 与 manifest 一致（**不比对 `version`**）
  - `entities.json`/`relations.json` 为合法 JSON

## 5. 发布与 index.json

- 合并 PR 后，发布工作流自动创建 GitHub Release（tag 为 `<id>@<version>`）并上传 zip。
- `index.json` 由 `scripts/build-index.mjs` 自动生成并写回仓库根目录，字段如下：

| 字段 | 说明 |
|---|---|
| `id` | 包 ID |
| `title` | `{"zh", "en"}` |
| `description` | `{"zh", "en"}` |
| `currentVersion` | 当前版本 |
| `downloadUrl` | Release 资产下载地址（`https://github.com/{owner}/{repo}/releases/download/{id}@{version}/{zip}`） |
| `language` | 语言 |

- 消费端（AI Reader X App / 网页目录）以 `index.json` 为数据源。
