import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";
import { email, password, text } from "../src/validation.js";

try {
  const nombre = text(process.env.ADMIN_NAME || "Administrador de Farmacia", "ADMIN_NAME", 120);
  const correo = email(process.env.ADMIN_EMAIL || "admin@farmacia.local");
  const plainPassword = password(process.env.ADMIN_PASSWORD);
  const hash = await bcrypt.hash(plainPassword, 12);
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, correo, password_hash, rol)
     VALUES ($1, $2, $3, 'administrador')
     ON CONFLICT (correo) DO NOTHING
     RETURNING id`,
    [nombre, correo, hash],
  );
  if (!result.rowCount) {
    throw new Error("Ya existe un usuario con ese correo; no se modificó ninguna cuenta.");
  }
  console.log("Administrador de farmacia creado.");
} catch (error) {
  console.error("No se pudo crear el administrador:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
