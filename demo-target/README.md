# 巡安 GitHub Pages 展示站

`demo-target/` 同时承担两个用途：

1. **比赛作品展示页**：介绍巡安的设计目标、巡检流程、核心能力、恒脑接入方式和部署步骤。
2. **授权合成测试目标**：提供一组明确标注为虚构的邮箱、内部标记和令牌格式，验证巡安从页面发现到报告输出的完整流程。

## 本地预览

在仓库根目录运行：

```bash
python3 -m http.server 4173 --directory demo-target
```

打开 `http://127.0.0.1:4173/`。页面不依赖前端框架或外部 CDN，可以直接由 GitHub Pages 托管。

## 自动部署

仓库中的 `.github/workflows/pages.yml` 会在 `main` 分支的 `demo-target/**` 发生变化时自动发布页面：

1. 将代码推送到 `main` 分支。
2. 在仓库的 **Actions** 页面查看部署进度。
3. 工作流显示绿色完成后，访问：
   `https://province-cybersecurity.github.io/Provincial-Cybersecurity-Competition/`

## 安全说明

- 页面中出现的邮箱、关键词和令牌均为虚构数据。
- 真实账号、密码、密钥、手机号或个人资料不得放入本目录。
- GitHub Pages 只能托管静态内容，不能运行仓库中的 Python 巡检后端。
- 启用页面后，应将完整公开网址加入 `XUNAN_ALLOWED_TARGETS`，再由巡安后端执行只读检查。
- 授权只覆盖本团队的演示页面，不覆盖 GitHub 平台、其他仓库或任何第三方网站。

## 页面结构

- `index.html`：完整作品介绍、动态交互和部署指南。
- `notice.html`：授权测试目标的用途、数据与边界说明。
- `assets/site.css`：响应式视觉样式和动态效果。
- `assets/demo.js`：页面交互，以及用于巡检识别的虚构令牌样例。
