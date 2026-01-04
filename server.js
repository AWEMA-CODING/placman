const http = require("http");
const fs = require("fs");
const path = require("path");

http
  .createServer((req, res) => {
    let file = req.url === "/" ? "index.html" : req.url.substring(1);
    file = decodeURIComponent(file); // IMPORTANT pour les espaces dans les mp3

    const ext = path.extname(file).toLowerCase();
    const type =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".css": "text/css; charset=utf-8",
      }[ext] || "application/octet-stream";

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found: " + file);
      } else {
        res.writeHead(200, { "Content-Type": type });
        res.end(data);
      }
    });
  })
  .listen(3000);

console.log("PLACMAN server running on http://localhost:3000");
