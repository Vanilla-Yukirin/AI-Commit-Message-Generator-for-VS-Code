# 本地构建指南 / Build Guide

[中文](#中文指南) | [English](#english-guide)

---

## 中文指南

### 环境准备

- **Node.js**: 建议使用 20.x 版本
- **Git**: 用于版本控制

### 安装依赖

```bash
npm install
```

### 本地开发与调试

1. **编译 TypeScript**
   ```bash
   npm run compile
   ```

2. **监视模式**（文件变化自动编译）
   ```bash
   npm run watch
   ```

3. **运行调试**
   - 在 VS Code 中按 `F5` 启动"扩展开发宿主"窗口
   - 在新窗口中测试插件功能

### 本地打包 VSIX

```bash
npm install -g @vscode/vsce
vsce package
```

生成的 `.vsix` 文件可通过 VS Code 的 **扩展 → ··· → 从 VSIX 安装** 选项手动安装。

### 发布新版本（通过 GitHub Actions）

1. 确保本地代码无编译错误：`npm run compile`
2. 更新 `package.json` 中的 `version` 字段
3. 提交并 push 到主分支
4. 创建并 push Git tag：
   ```bash
   git tag v1.x.x
   git push origin v1.x.x
   ```
5. GitHub Actions 将自动触发构建和发布

---

## English Guide

### Prerequisites

- **Node.js**: Version 20.x recommended
- **Git**: For version control

### Install Dependencies

```bash
npm install
```

### Local Development & Debugging

1. **Compile TypeScript**
   ```bash
   npm run compile
   ```

2. **Watch Mode** (auto-compile on file changes)
   ```bash
   npm run watch
   ```

3. **Run & Debug**
   - Press `F5` in VS Code to launch "Extension Development Host"
   - Test the extension in the new window

### Package VSIX Locally

```bash
npm install -g @vscode/vsce
vsce package
```

The generated `.vsix` file can be installed via **Extensions → ··· → Install from VSIX** in VS Code.

### Release New Version (via GitHub Actions)

1. Ensure no compile errors: `npm run compile`
2. Update `version` field in `package.json`
3. Commit and push to main branch
4. Create and push Git tag:
   ```bash
   git tag v1.x.x
   git push origin v1.x.x
   ```
5. GitHub Actions will automatically trigger build and release
