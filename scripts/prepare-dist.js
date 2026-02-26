const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const vendorDir = path.join(distDir, "vendor");
const moduleDir = path.join(projectRoot, "js");
const distModuleDir = path.join(distDir, "js");
const filesToCopy = ["index.html", "styles.css", "app.js"];
const vendorFiles = [
  {
    source: path.join(projectRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.min.js"),
    target: path.join(vendorDir, "pdf.min.js"),
  },
  {
    source: path.join(projectRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.js"),
    target: path.join(vendorDir, "pdf.worker.min.js"),
  },
  {
    source: path.join(projectRoot, "node_modules", "pdf-lib", "dist", "pdf-lib.min.js"),
    target: path.join(vendorDir, "pdf-lib.min.js"),
  },
];

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

function copyVendorFiles() {
  fs.mkdirSync(vendorDir, { recursive: true });

  for (const item of vendorFiles) {
    if (!fs.existsSync(item.source)) {
      throw new Error(
        `Missing required vendor file: ${item.source}\nRun 'npm install' to install PDF dependencies.`
      );
    }

    fs.copyFileSync(item.source, item.target);
  }
}

function copyModuleFiles() {
  if (!fs.existsSync(moduleDir)) {
    return;
  }

  fs.cpSync(moduleDir, distModuleDir, { recursive: true });
}

function main() {
  ensureCleanDist();
  copyStaticFiles();
  copyModuleFiles();
  copyVendorFiles();
  process.stdout.write("Prepared dist directory for Tauri build.\n");
}

main();

