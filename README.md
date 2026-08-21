# AI Reader X 技能包社区分享库

AI Reader X 知识图谱技能包（skill package）的社区分享仓库。任何人可通过 Pull Request 投稿自己制作的技能包，经自动校验通过后合并并发布，供读者下载导入。

## 技能包是什么

技能包是由 AI Reader X Creator 导出的知识包，包含：

- `SKILL.md` — 技能元数据（标题、简介、作者）
- `entities.json` / `relations.json` — 知识图谱实体与关系（v2.0 格式）
- `chapters/`、`original_chapters/` — 章节内容
- 编译产物（`core.md`、`chapter_index.md` 等，可选）

## 目录浏览

> 仓库只存元数据与校验脚本；zip 包走 GitHub Releases 分发（保持仓库轻量，见 [PACKAGE_SPEC](./docs/PACKAGE_SPEC.md)）。

### 已收录技能包

| 包 | 版本 | 语言 | 版权 | 下载 |
|---|---|---|---|---|
| _（发布后自动填充，见 `index.json`）_ | | | | |

> `index.json` 由发布工作流自动生成，字段规范见 [PACKAGE_SPEC](./docs/PACKAGE_SPEC.md)。

## 投稿

- 想投稿？阅读 [CONTRIBUTING](./CONTRIBUTING.md) 与 [PACKAGE_SPEC](./docs/PACKAGE_SPEC.md)（manifest 规范）、[CREATOR_GUIDE](./docs/CREATOR_GUIDE.md)（Creator 制作打包指引）。
- 校验在 PR 上自动执行，错误信息见 check run 日志。

## 版权红线

仅接受 `public_domain` / `cc` / `licensed` 三类版权状态的包；**基于个人购买书籍制作的提炼包一律不接受分发**（见 [PACKAGE_SPEC](./docs/PACKAGE_SPEC.md) 版权一节）。

## License

仓库代码（元数据、脚本、文档）采用 MIT License，见 [LICENSE](./LICENSE)。各技能包内容版权归各自作者，以包内 `copyright` 声明为准。
