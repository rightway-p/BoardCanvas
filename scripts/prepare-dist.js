const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const filesToCopy = ["index.html", "styles.css", "app.js"];

function ensureCleanDist() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
}

function copyStaticFiles() {
  for (const fileName of filesToCopy) {
    const source = path.join(projectRoot, fileName);
    const target = path.join(distDir, fileName);

    if (!fs.existsSync(source)) {
      throw new Error(`Missing required file: ${fileName}`);
    }

    fs.copyFileSync(source, target);
  }
}

function main() {
  ensureCleanDist();
  copyStaticFiles();
  process.stdout.write("Prepared dist directory for Tauri build.\n");
}

main();

