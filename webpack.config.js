const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = [
  {
    mode: "production",
    target: "electron-main",
    devtool: "source-map",
    entry: "./src/main/index.ts",
    module: {
      rules: [{ test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ }],
    },
    resolve: {
      extensions: [".ts", ".js"],
      alias: { "@shared": path.resolve(__dirname, "src/shared") },
    },
    output: { filename: "main.js", path: path.resolve(__dirname, "dist") },
    externals: {
      robotjs: "commonjs robotjs",
      koffi: "commonjs koffi",
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: "src/main/guide/guide-overlay.html", to: "guide-overlay.html" },
          { from: "assets/owl-wing-pointer.png", to: "owl-wing-pointer.png" },
        ],
      }),
    ],
  },
  {
    mode: "production",
    target: "electron-preload",
    devtool: "source-map",
    entry: "./src/preload.ts",
    module: {
      rules: [{ test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ }],
    },
    resolve: {
      extensions: [".ts", ".js"],
      alias: { "@shared": path.resolve(__dirname, "src/shared") },
    },
    output: {
      filename: "preload.js",
      path: path.resolve(__dirname, "dist"),
    },
  },
  {
    mode: "production",
    target: "electron-preload",
    devtool: "source-map",
    entry: "./src/main/area-preload.ts",
    module: {
      rules: [{ test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ }],
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    output: {
      filename: "area-preload.js",
      path: path.resolve(__dirname, "dist"),
    },
  },
  {
    mode: "production",
    target: "electron-preload",
    devtool: "source-map",
    entry: "./src/main/guide/guide-overlay-preload.ts",
    module: {
      rules: [{ test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ }],
    },
    resolve: { extensions: [".ts", ".js"] },
    output: {
      filename: "guide-overlay-preload.js",
      path: path.resolve(__dirname, "dist"),
    },
  },
  {
    mode: "production",
    target: "web",
    devtool: "source-map",
    entry: "./src/main/guide/guide-overlay-renderer.ts",
    module: {
      rules: [{ test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ }],
    },
    resolve: { extensions: [".ts", ".js"] },
    output: {
      filename: "guide-overlay-renderer.js",
      path: path.resolve(__dirname, "dist"),
    },
  },
  {
    mode: "production",
    target: "electron-renderer",
    devtool: "source-map",
    entry: "./src/renderer/index.tsx",
    module: {
      rules: [
        { test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ },
        { test: /\.tsx$/, use: "ts-loader", exclude: /node_modules/ },
        { test: /\.css$/, use: ["style-loader", "css-loader"] },
      ],
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
      alias: { "@shared": path.resolve(__dirname, "src/shared") },
    },
    output: {
      filename: "renderer.js",
      path: path.resolve(__dirname, "dist"),
    },
    plugins: [
      new HtmlWebpackPlugin({ template: "./src/renderer/index.html" }),
    ],
  },
];
