import assert from "node:assert/strict";
import test from "node:test";
import { mapMovement, mapSale } from "../src/services/common.js";

test("serializes sale timestamps as ISO strings for SOAP responses", () => {
  const sale = mapSale({
    id: 1,
    numero: "V-1",
    usuario_id: 2,
    fecha: new Date("2026-11-23T12:00:00.000Z"),
    total: "17500.00",
    estado: "confirmada",
  });

  assert.equal(sale.fecha, "2026-11-23T12:00:00.000Z");
});

test("maps the actor name and role onto inventory movements", () => {
  const movement = mapMovement({
    id: 1,
    lote_id: 4,
    venta_id: null,
    usuario_id: 2,
    usuario_nombre: "Administrador de Farmacia",
    usuario_rol: "administrador",
    tipo: "ajuste",
    cantidad: 5,
    stock_antes: 10,
    stock_despues: 15,
    motivo: "Ajuste de existencias",
    fecha: new Date("2026-11-23T12:00:00.000Z"),
  });

  assert.equal(movement.usuarioNombre, "Administrador de Farmacia");
  assert.equal(movement.usuarioRol, "administrador");
  assert.equal(movement.fecha, "2026-11-23T12:00:00.000Z");
});
