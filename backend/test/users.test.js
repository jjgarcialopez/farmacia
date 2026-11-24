import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "unit-test-only-secret-with-at-least-32-bytes";
const { config } = await import("../src/config.js");
const { createUserOperations } = await import("../src/services/users.js");

const admin = {
  id: "1",
  nombre: "Administrador",
  correo: "admin@farmacia.com",
  rol: "administrador",
  activo: true,
  creado_en: new Date("2026-01-01T00:00:00.000Z"),
};
const headers = {
  AuthHeader: {
    token: jwt.sign({}, config.jwtSecret, {
      algorithm: "HS256",
      subject: admin.id,
      issuer: config.jwtIssuer,
    }),
  },
};

function authQuery(sql) {
  if (sql.includes("FROM usuarios") && sql.includes("WHERE id = $1")) {
    return { rows: [admin], rowCount: 1 };
  }
  throw new Error(`Unexpected pool query: ${sql}`);
}

test("reactivates an inactive user through the administrator operation", async () => {
  const inactive = { ...admin, id: "2", rol: "vendedor", activo: false };
  let activated = false;
  const client = {
    async query(sql) {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("FOR UPDATE")) return { rows: [inactive], rowCount: 1 };
      if (sql.includes("SET activo = TRUE")) {
        activated = true;
        return { rows: [{ ...inactive, activo: true }], rowCount: 1 };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  };
  const operations = createUserOperations({
    pool: { query: async (sql) => authQuery(sql) },
    withTransaction: (work) => work(client),
  });

  const result = await operations.ActivateUser({ id: "2" }, null, headers);
  assert.equal(activated, true);
  assert.equal(result.success, true);
  assert.equal(result.user.activo, true);
});

test("allows distinct user accounts to share the same role", async () => {
  const insertedUsers = [];
  const pool = {
    async query(sql, values) {
      if (sql.includes("WHERE id = $1")) return authQuery(sql);
      if (sql.includes("INSERT INTO usuarios")) {
        const row = {
          ...admin,
          id: String(insertedUsers.length + 2),
          nombre: values[0],
          usuario: values[1],
          correo: values[2],
          rol: values[4],
        };
        insertedUsers.push(row);
        return { rows: [row], rowCount: 1 };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  const createUser = createUserOperations({ pool }).CreateUser;

  for (const [nombre, correo] of [
    ["Vendedor Uno", "vendedor.uno@farmacia.com"],
    ["Vendedor Dos", "vendedor.dos@farmacia.com"],
  ]) {
    await createUser({ nombre, correo, password: "ClaveSegura2026!", rol: "vendedor" }, null, headers);
  }

  assert.equal(insertedUsers.length, 2);
  assert.deepEqual(insertedUsers.map((user) => user.rol), ["vendedor", "vendedor"]);
});

test("explains that a duplicate corporate email may belong to an inactive account", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("WHERE id = $1")) return authQuery(sql);
      const error = new Error("duplicate key");
      error.code = "23505";
      error.constraint = "usuarios_correo_key";
      throw error;
    },
  };
  const createUser = createUserOperations({ pool }).CreateUser;

  await assert.rejects(
    createUser({
      nombre: "Vendedor",
      correo: "vendedor@farmacia.com",
      password: "ClaveSegura2026!",
      rol: "vendedor",
    }, null, headers),
    (error) => {
      assert.match(error.Fault.Reason.Text, /correo debe ser único/);
      return true;
    },
  );
});
