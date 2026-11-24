import assert from "node:assert/strict";
import test from "node:test";
import {
  boolean,
  corporateEmail,
  isoDate,
  money,
  pagination,
  positiveId,
} from "../src/validation.js";

test("validates positive identifiers and strict boolean filters", () => {
  assert.equal(positiveId("12"), "12");
  assert.throws(() => positiveId("0"), /entero positivo/);
  assert.throws(() => positiveId("1e2"), /entero positivo/);
  assert.equal(boolean("false", "activo"), false);
  assert.throws(() => boolean("yes", "activo"), /true o false/);
});

test("restricts managed user emails to the corporate domain", () => {
  assert.equal(corporateEmail("Farmaceutico@farmacia.com"), "farmaceutico@farmacia.com");
  assert.throws(() => corporateEmail("farmaceutico@example.com"), /dominio @farmacia\.com/);
});

test("validates money precision, ISO dates, and pagination boundaries", () => {
  assert.equal(money("125.5", "precio"), "125.50");
  assert.throws(() => money("-1", "precio"), /mayor o igual a cero/);
  assert.equal(isoDate("2028-02-29", "fecha"), "2028-02-29");
  assert.equal(isoDate(new Date("2028-01-15T00:00:00.000Z"), "fecha"), "2028-01-15");
  assert.throws(() => isoDate("2027-02-29", "fecha"), /fecha/);
  assert.throws(() => isoDate(new Date(Number.NaN), "fecha"), /fecha/);
  assert.throws(() => isoDate("0000-01-01", "fecha"), /fecha/);
  assert.deepEqual(pagination({ limit: "100", offset: "0" }), { limit: 100, offset: 0 });
  assert.throws(() => pagination({ limit: "101" }), /entre 1 y 100/);
});
