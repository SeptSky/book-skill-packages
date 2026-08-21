# 投稿指南

感谢你的贡献。投稿流程：

## 1. 准备技能包

用 AI Reader X Creator 制作并导出技能包，步骤见 [CREATOR_GUIDE](./docs/CREATOR_GUIDE.md)。导出后你会得到一个 zip 文件。

## 2. 编写 manifest

在 `packages/<id>/` 下创建 `manifest.json`，字段规范见 [PACKAGE_SPEC](./docs/PACKAGE_SPEC.md)。

```
packages/
└── <id>/
    ├── manifest.json   # 元数据
    └── <id>-<version>.zip   # 技能包（发布后不进仓库，见下文）
```

## 3. 发起 Pull Request

1. fork 本仓库
2. 创建分支（如 `feat/add-<id>`）
3. 添加 `packages/<id>/manifest.json` 与 zip 文件
4. 发起 PR。校验工作流会自动运行（`validate.mjs`），结果见 PR 的 check run 日志

## 4. 合并与发布

- 校验通过后，维护者合并 PR。
- 合并后发布工作流自动：从 PR 提取 zip → 创建 GitHub Release → 更新 `index.json`。
- zip 仅作为 PR 暂态文件存在，发布后由仓库清理，仓库保持轻量（下载走 Releases）。

## 校验失败怎么办

错误信息在 PR 的 **check run** 日志中（fork PR 无法被 CI 评论）。按日志逐条修复后重新 push 即可。

## 版权红线（必读）

- `copyright.status` 仅允许 `public_domain` / `cc` / `licensed`。
- **基于个人购买书籍制作的提炼包一律不接受分发**——即使你认为内容已被充分改写。
- 版权合规是声明校验而非内容验证：请务必对版权状态负责，维护者保留移除不合规包的权利。

## 体积要求

- zip ≤ 50MB（CI 校验硬限；超出时先压缩图片或缩小范围）。

## 行为准则

- 只投稿你自己制作、且有权分发的包。
- 尊重他人版权与知识产权。
