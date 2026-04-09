const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = [
  {
    mode: "development",
    target: "electron-main",
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
    },
  },
  {
    mode: "development",
    target: "electron-preload",
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
    mode: "development",
    target: "electron-renderer",
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