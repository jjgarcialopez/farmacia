import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(backendDir, "..");

dotenv.config({ path: path.join(backendDir, ".env") });
dotenv.config({ path: path.join(rootDir, ".env") });

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret, "utf8") < 32) {
  throw new Error("JWT_SECRET debe tener al menos 32 bytes.");
}

const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || "farmacia",
    };

export const config = {
  backendDir,
  port: Number(process.env.PORT || 4000),
  jwtSecret,
  jwtIssuer: "farmacia-soap",
  tokenLifetime: "2h",
  corsOrigin: process.env.CORS_ORIGIN || "",
  dbConfig,
  nodeEnv: process.env.NODE_ENV || "development",
};
