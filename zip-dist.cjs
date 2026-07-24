const fs = require("fs");
const path = require("path");
const { ZipArchive } = require("archiver");

const output = fs.createWriteStream(
  path.join(__dirname, "frontend.zip")
);

const archive = new ZipArchive({
  zlib: { level: 9 }
});

output.on("close", () => {
  console.log(`frontend.zip created (${archive.pointer()} bytes)`);
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);

archive.directory("dist/", false);

archive.finalize();