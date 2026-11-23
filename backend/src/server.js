import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import soap from "soap";
import { config } from "./config.js";
import { pool, withTransaction } from "./db.js";
import { createSoapServices } from "./services/index.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const wsdlPath = path.resolve(serverDir, "../wsdl/farmacia.wsdl");
const wsdlTemplate = await readFile(wsdlPath, "utf8");
const wsdl = wsdlTemplate.replace(
  /http:\/\/localhost:4000\/soap/g,
  `http://localhost:${config.port}/soap`,
);

function applyHttpHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  if (config.corsOrigin && req.headers.origin === config.corsOrigin) {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, SOAPAction");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  }
}

const server = http.createServer(async (req, res) => {
  applyHttpHeaders(req, res);
  if (req.method === "GET" && req.url === "/health") {
    try {
      await pool.query("SELECT 1");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "farmacia-soap" }));
    } catch (error) {
      console.error("La comprobación de PostgreSQL falló.", error);
      res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "database_unavailable" }));
    }
    return;
  }
  if (req.url === "/soap" || req.url?.startsWith("/soap?")) return;
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

const soapServer = soap.listen(server, "/soap", createSoapServices({ pool, withTransaction }), wsdl);
soapServer.authorizeConnection = (req, res) => {
  applyHttpHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return false;
  }
  return true;
};

server.listen(config.port, () => {
  console.log(`Farmacia SOAP disponible en http://localhost:${config.port}/soap`);
  console.log(`WSDL: http://localhost:${config.port}/soap?wsdl`);
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`Cerrando backend (${signal}).`);
  server.close(async (error) => {
    if (error) console.error("Error al cerrar el servidor HTTP.", error);
    await pool.end();
    process.exit(error ? 1 : 0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
