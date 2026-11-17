# 图片转文档

**线上地址：https://xiahezaixiamen.github.io/pic2doc/**

手机端小工具：把多张图片按你排好的顺序，导出成 PDF 或 Word。
所有处理都在浏览器本地完成，图片不会上传到任何服务器。

## 怎么用

1. 点「添加图片」，一次可以选多张（手机上可直接拍照或从相册选）
2. 用每张卡片下方的 ↑ ↓ 调整顺序，左上角数字就是文档里的页序
3. 需要的话关掉「Word 每张图片单独一页」，改成连续排版
4. 点「导出 PDF」或「导出 Word」

## 怎么打开

必须通过 http 访问，不能直接双击 index.html（浏览器对本地文件的脚本有限制）。

在本目录下起个静态服务即可：

```
python -m http.server 8080
```

然后浏览器打开 `http://127.0.0.1:8080/`。

手机上测试时，让手机和电脑在同一 Wi-Fi 下，用电脑的局域网 IP 访问（例如 `http://192.168.1.10:8080/`）。

## 部署

整个目录就是纯静态站点，已部署在 GitHub Pages（仓库 [xiahezaixiamen/pic2doc](https://github.com/xiahezaixiamen/pic2doc)，`main` 分支根目录）。

更新流程：

```
git add -A && git commit -m "说明" && git push
```

推送后 GitHub Pages 会自动重新构建，约 1 分钟后生效。

也可以丢到任意其他静态托管（Cloudflare Pages、Vercel、对象存储等），无需后端。
支持加到手机主屏幕（PWA），离线也能用。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构 |
| `style.css` | 样式（手机优先） |
| `app.js` | 全部逻辑：读图、排序、压缩、导出 |
| `lib/jspdf.umd.min.js` | 生成 PDF |
| `lib/docx.iife.js` | 生成 Word |
| `manifest.webmanifest` / `sw.js` / `icon-*.png` | PWA 安装与离线 |

## 实现细节

- 图片读取用 `createImageBitmap`，会自动按 EXIF 旋转，避免手机竖拍照片导入后方向错乱
- 大图先压到长边 2000px、JPEG 质量 0.88，控制导出体积
- PDF 按 A4 竖版、每张图一页、等比缩放居中
- Word 按 A4、图片等比缩放到页面可用宽度内，可选每张一页或连续排版

## 已知限制

- iPhone 的 HEIC 格式，部分浏览器无法解码，会提示读取失败。可先在系统相册里截图或另存为 JPG
- 图片数量和单张体积过大时，导出会变慢并占用较多内存
