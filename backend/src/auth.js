import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { AppError } from "./errors.js";
import { email } from "./validation.js";

const dummyPasswordHash = await bcrypt.hash(randomUUID(), 12);

export function publicUser(row) {
  return {
    id: String(row.id),
    nombre: row.nombre,
    correo: row.correo,
    rol: row.rol,
    activo: row.activo,
    creadoEn: row.creado_en,
  };
}

export function createLoginThrottle({ maxAttempts = 5, windowMs = 15 * 60_000, maxKeys = 5000 } = {}) {
  const attempts = new Map();

  return {
    check(key, now = Date.now()) {
      const current = attempts.get(key);
      if (!current || current.expiresAt <= now) {
        attempts.set(key, { count: 1, expiresAt: now + windowMs });
        if (attempts.size > maxKeys) {
          for (const [storedKey, entry] of attempts) {
            if (entry.expiresAt <= now) attempts.delete(storedKey);
          }
          while (attempts.size > maxKeys) attempts.delete(attempts.keys().next().value);
        }
        return;
      }
      if (current.count >= maxAttempts) {
        throw new AppError("RATE_LIMITED", "Demasiados intentos. Intenta de nuevo más tarde.", 429);
      }
      current.count += 1;
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}

export async function login({ correo, password: rawPassword, ip }, db, throttle) {
  const normalizedEmail = email(correo);
  if (typeof rawPassword !== "string" || rawPassword.length < 1 || rawPassword.length > 200) {
    throw new AppError("INVALID_CREDENTIALS", "Correo o contraseña incorrectos.", 401);
  }
  const key = `${ip || "unknown"}:${normalizedEmail}`;
  throttle.check(key);

  const result = await db.query(
    `SELECT id, nombre, correo, password_hash, rol, activo, creado_en
       FROM usuarios
      WHERE correo = $1`,
    [normalizedEmail],
  );
  const found = result.rows[0];
  const validPassword = await bcrypt.compare(
    rawPassword,
    found?.activo ? found.password_hash : dummyPasswordHash,
  );
  if (!found || !found.activo || !validPassword) {
    throw new AppError("INVALID_CREDENTIALS", "Correo o contraseña incorrectos.", 401);
  }

  throttle.reset(key);
  const user = publicUser(found);
  const token = jwt.sign({ rol: user.rol }, config.jwtSecret, {
    algorithm: "HS256",
    subject: user.id,
    issuer: config.jwtIssuer,
    expiresIn: config.tokenLifetime,
  });
  return { token, expiresInSeconds: 2 * 60 * 60, user };
}

export async function authenticatedUser(headers, db) {
  const authHeader = headers.AuthHeader || headers.authHeader || headers["tns:AuthHeader"];
  const token = typeof authHeader === "string" ? authHeader : authHeader?.token;
  if (typeof token !== "string" || token.length < 20) {
    throw new AppError("UNAUTHENTICATED", "Envía un token válido en el encabezado SOAP AuthHeader.", 401);
  }

  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
      issuer: config.jwtIssuer,
    });
  } catch {
    throw new AppError("UNAUTHENTICATED", "La sesión no es válida o ha expirado.", 401);
  }

  const id = String(claims.sub || "");
  if (!/^[1-9]\d*$/.test(id)) {
    throw new AppError("UNAUTHENTICATED", "La sesión no es válida o ha expirado.", 401);
  }
  const result = await db.query(
    `SELECT id, nombre, correo, rol, activo, creado_en
       FROM usuarios
      WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row?.activo) {
    throw new AppError("UNAUTHENTICATED", "La cuenta está inactiva o la sesión no es válida.", 401);
  }
  return publicUser(row);
}

export async function requireRoles(headers, db, allowedRoles) {
  const user = await authenticatedUser(headers, db);
  if (!allowedRoles.includes(user.rol)) {
    throw new AppError("FORBIDDEN", "No tienes permiso para realizar esta operación.", 403);
  }
  return user;
}
