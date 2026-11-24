import bcrypt from "bcryptjs";
import { AppError } from "../errors.js";
import { requireRoles } from "../auth.js";
import { boolean, corporateEmail, pagination, password, positiveId, role, text } from "../validation.js";
import { mapUser, operation, pageQuery, notFound } from "./common.js";

const ADMIN = ["administrador"];
const SELECT_USER = "id, nombre, usuario, correo, rol, activo, creado_en";

async function lockAdminChanges(client) {
  await client.query("SELECT pg_advisory_xact_lock(726184, 1)");
}

async function ensureNotLastAdmin(client, userRow, nextRole, nextActive) {
  const isRemovingAdmin = userRow.rol === "administrador"
    && userRow.activo
    && (nextRole !== undefined && nextRole !== "administrador"
      || nextActive === false);
  if (!isRemovingAdmin) return;
  const result = await client.query(
    "SELECT COUNT(*)::INTEGER AS total FROM usuarios WHERE rol = 'administrador' AND activo = TRUE",
  );
  if (result.rows[0].total <= 1) {
    throw new AppError("LAST_ADMIN", "No se puede degradar o desactivar al último administrador activo.", 409);
  }
}

export function createUserOperations({ pool, withTransaction }) {
  return {
    ListUsers: operation("ListUsers", async (args, headers) => {
      await requireRoles(headers, pool, ADMIN);
      const { limit, offset } = pagination(args);
      const conditions = [];
      const values = [];
      if (args.rol !== undefined && args.rol !== "") {
        values.push(role(args.rol));
        conditions.push(`rol = $${values.length}`);
      }
      if (args.activo !== undefined && args.activo !== "") {
        values.push(boolean(args.activo, "activo"));
        conditions.push(`activo = $${values.length}`);
      }
      const result = await pageQuery(pool, {
        select: SELECT_USER,
        from: "usuarios",
        conditions,
        values,
        orderBy: "id",
        limit,
        offset,
      });
      return {
        total: result.total,
        limit,
        offset,
        users: { user: result.items.map(mapUser) },
      };
    }),

    GetUser: operation("GetUser", async (args, headers) => {
      await requireRoles(headers, pool, ADMIN);
      const id = positiveId(args.id);
      const result = await pool.query(`SELECT ${SELECT_USER} FROM usuarios WHERE id = $1`, [id]);
      if (!result.rowCount) throw notFound("El usuario");
      return { user: mapUser(result.rows[0]) };
    }),

    CreateUser: operation("CreateUser", async (args, headers) => {
      await requireRoles(headers, pool, ADMIN);
      const nombre = text(args.nombre, "nombre", 120);
      const correo = args.correo === undefined || args.correo === "" ? null : corporateEmail(args.correo);
      const usuario = args.usuario === undefined || args.usuario === ""
        ? (correo ? correo.split("@")[0] : undefined)
        : text(args.usuario, "usuario", 64).toLowerCase();
      if (!usuario) {
        throw new AppError("VALIDATION_ERROR", "El usuario es obligatorio.");
      }
      if (!/^[a-z0-9._+-]+$/.test(usuario)) {
        throw new AppError("VALIDATION_ERROR", "El usuario solo puede contener letras, números, punto, guion y guion bajo.");
      }
      const plainPassword = password(args.password);
      const userRole = args.rol === undefined || args.rol === "" ? "vendedor" : role(args.rol);
      const hash = await bcrypt.hash(plainPassword, 12);
      let result;
      try {
        result = await pool.query(
          `INSERT INTO usuarios (nombre, usuario, correo, password_hash, rol)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${SELECT_USER}`,
          [nombre, usuario, correo, hash, userRole],
        );
      } catch (error) {
        if (error.code === "23505" && error.constraint === "usuarios_correo_key") {
          throw new AppError(
            "USER_EMAIL_EXISTS",
            "Ese correo ya está registrado. El rol puede repetirse, pero el correo debe ser único. Si corresponde, reactiva la cuenta existente desde Administración de usuarios.",
            409,
          );
        }
        throw error;
      }
      return { user: mapUser(result.rows[0]) };
    }),

    UpdateUser: operation("UpdateUser", async (args, headers) => {
      await requireRoles(headers, pool, ADMIN);
      const id = positiveId(args.id);
      const updates = [];
      const values = [];
      if (args.nombre !== undefined) {
        values.push(text(args.nombre, "nombre", 120));
        updates.push(`nombre = $${values.length}`);
      }
      if (args.usuario !== undefined) {
        const usuario = text(args.usuario, "usuario", 64).toLowerCase();
        if (!/^[a-z0-9._+-]+$/.test(usuario)) {
          throw new AppError("VALIDATION_ERROR", "El usuario solo puede contener letras, números, punto, guion y guion bajo.");
        }
        values.push(usuario);
        updates.push(`usuario = $${values.length}`);
      }
      if (args.correo !== undefined) {
        values.push(corporateEmail(args.correo));
        updates.push(`correo = $${values.length}`);
      }
      let nextRole;
      if (args.rol !== undefined) {
        nextRole = role(args.rol);
        values.push(nextRole);
        updates.push(`rol = $${values.length}`);
      }
      if (args.password !== undefined) {
        values.push(await bcrypt.hash(password(args.password), 12));
        updates.push(`password_hash = $${values.length}`);
      }
      if (!updates.length) throw new AppError("VALIDATION_ERROR", "Debes enviar al menos un campo para actualizar.");

      const row = await withTransaction(async (client) => {
        await lockAdminChanges(client);
        const existing = await client.query(
          `SELECT ${SELECT_USER} FROM usuarios WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!existing.rowCount) throw notFound("El usuario");
        await ensureNotLastAdmin(client, existing.rows[0], nextRole);
        values.push(id);
        const updated = await client.query(
          `UPDATE usuarios SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING ${SELECT_USER}`,
          values,
        );
        return updated.rows[0];
      });
      return { user: mapUser(row) };
    }),

    DeactivateUser: operation("DeactivateUser", async (args, headers) => {
      const actor = await requireRoles(headers, pool, ADMIN);
      const id = positiveId(args.id);
      if (actor.id === id) {
        throw new AppError("SELF_DEACTIVATION", "No puedes desactivar tu propia cuenta.", 409);
      }
      const row = await withTransaction(async (client) => {
        await lockAdminChanges(client);
        const existing = await client.query(
          `SELECT ${SELECT_USER} FROM usuarios WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!existing.rowCount) throw notFound("El usuario");
        if (!existing.rows[0].activo) return existing.rows[0];
        await ensureNotLastAdmin(client, existing.rows[0], undefined, false);
        const updated = await client.query(
          `UPDATE usuarios SET activo = FALSE WHERE id = $1 RETURNING ${SELECT_USER}`,
          [id],
        );
        return updated.rows[0];
      });
      return { success: true, user: mapUser(row) };
    }),

    ActivateUser: operation("ActivateUser", async (args, headers) => {
      await requireRoles(headers, pool, ADMIN);
      const id = positiveId(args.id);
      const row = await withTransaction(async (client) => {
        await lockAdminChanges(client);
        const existing = await client.query(
          `SELECT ${SELECT_USER} FROM usuarios WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!existing.rowCount) throw notFound("El usuario");
        if (existing.rows[0].activo) return existing.rows[0];
        const updated = await client.query(
          `UPDATE usuarios SET activo = TRUE WHERE id = $1 RETURNING ${SELECT_USER}`,
          [id],
        );
        return updated.rows[0];
      });
      return { success: true, user: mapUser(row) };
    }),
  };
}
