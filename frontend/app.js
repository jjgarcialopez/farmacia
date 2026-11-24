import { matchingMedicationsWithoutBatches, normalizeSearchText } from "./search.js";

const API_URL = window.APP_CONFIG?.apiUrl || "http://localhost:4000/soap";
const HEALTH_URL = window.APP_CONFIG?.healthUrl || "http://localhost:4000/health";
const SESSION_WARNING_MS = (window.APP_CONFIG?.sessionWarningMinutes || 5) * 60_000;
const PAGE_SIZE = 100;
const ROLES = ["administrador", "farmaceutico", "vendedor"];
const state = {
  token: "",
  user: null,
  sessionExpiry: 0,
  sessionWarningShown: false,
  loading: false,
  connection: "checking",
  route: "inicio",
  inventoryTab: "lotes",
  medications: [],
  batches: [],
  alerts: [],
  sales: [],
  users: [],
  movements: [],
  movementsLoaded: false,
  search: "",
  batchSearch: "",
  userFilters: { rol: "", activo: "" },
  modal: null,
  modalError: "",
  toast: "",
  movementFilters: {},
  salesFilters: {},
  salesPrevious: [],
  salePreview: null,
  salePreviewError: "",
  salePreviewLoading: false,
  salePreviewKey: "",
  salePreviewRequest: 0,
  saleItems: [{ medicamentoId: "", cantidad: 1, busqueda: "", opcionesAbiertas: false }],
  pagination: {},
  tableSort: {},
  searchTimers: {},
};

const app = document.querySelector("#app");
const icon = (name, className = "") => {
  const paths = {
    home: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    pills: '<path d="m10.5 20.5 10-10a5.7 5.7 0 0 0-8-8l-10 10a5.7 5.7 0 0 0 8 8Z"/><path d="m8.5 8.5 7 7"/>',
    box: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M3 8v9l9 5 9-5V8"/><path d="M12 13v9"/>',
    warehouse: '<path d="M3 10 12 4l9 6v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="M9 21v-7h6v7M7 11h.01M12 11h.01M17 11h.01"/>',
    receipt: '<path d="M4 3v18l3-2 3 2 2-2 3 2 2-2 3 2V3l-3 2-3-2-2 2-3-2-2 2-3-2Z"/><path d="M8 9h8M8 13h8"/>',
    print: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/><path d="M18 12h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    activity: '<path d="M3 12h4l3-9 4 18 3-9h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 12a9 9 0 0 0-15.55-6L3 7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>',
    plusCircle: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8m-4-4h8"/>',
  };
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function child(parent, name) {
  return Array.from(parent?.children || []).find((element) => element.localName === name) || null;
}

function children(parent, wrapper, item) {
  return Array.from(child(parent, wrapper)?.children || [])
    .filter((element) => element.localName === item);
}

function field(parent, name) {
  return child(parent, name)?.textContent?.trim() || "";
}

function descendantText(parent, name) {
  return parent?.getElementsByTagNameNS("*", name)[0]?.textContent?.trim() || "";
}

function readResponse(xml, operation) {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.getElementsByTagName("parsererror")[0]) {
    throw new Error("El servidor devolviÃƒÂ³ una respuesta SOAP que no se pudo interpretar.");
  }
  const fault = document.getElementsByTagNameNS("*", "Fault")[0];
  if (fault) {
    const reason = descendantText(fault, "faultstring")
      || descendantText(fault, "Text")
      || "Error en el servicio.";
    throw new Error(reason.replace(/^[A-Z_]+:\s*/, ""));
  }
  const result = document.getElementsByTagNameNS("*", `${operation}Response`)[0];
  if (!result) throw new Error(`El servicio no devolviÃƒÂ³ la respuesta esperada para ${operation}.`);
  return result;
}

function serializeTag(name, value) {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.map((item) => serializeTag(name, item)).join("");
  if (typeof value === "object") {
    return `<farm:${name}>${Object.entries(value).map(([key, childValue]) => serializeTag(key, childValue)).join("")}</farm:${name}>`;
  }
  return `<farm:${name}>${escapeHTML(value)}</farm:${name}>`;
}

async function soapCall(operation, args = {}, authenticated = true) {
  const argsXml = Object.entries(args).map(([key, value]) => serializeTag(key, value)).join("");
  const authXml = authenticated
    ? `<soapenv:Header><farm:AuthHeader><farm:token>${escapeHTML(state.token)}</farm:token></farm:AuthHeader></soapenv:Header>`
    : "";
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:farm="urn:farmacia:v1">${authXml}<soapenv:Body><farm:${operation}>${argsXml}</farm:${operation}></soapenv:Body></soapenv:Envelope>`;

  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"urn:farmacia:v1#${operation}"` },
      body: envelope,
    });
  } catch {
    throw new Error("No fue posible conectar con el backend. Verifica que estÃƒÂ© activo y que CORS_ORIGIN estÃƒÂ© configurado.");
  }
  const result = readResponse(await response.text(), operation);
  if (!response.ok) throw new Error(`El servicio respondiÃƒÂ³ con estado ${response.status}.`);
  return result;
}

function parseMedication(element) {
  return {
    id: field(element, "id"),
    codigo: field(element, "codigo"),
    nombre: field(element, "nombre"),
    principioActivo: field(element, "principioActivo"),
    presentacion: field(element, "presentacion"),
    requiereFormula: field(element, "requiereFormula") === "true",
    precioReferencia: field(element, "precioReferencia"),
    activo: field(element, "activo") === "true",
  };
}

function parseBatch(element) {
  return {
    id: field(element, "id"),
    medicamentoId: field(element, "medicamentoId"),
    medicamentoNombre: field(element, "medicamentoNombre"),
    codigoLote: field(element, "codigoLote"),
    fechaVencimiento: field(element, "fechaVencimiento"),
    stock: Number(field(element, "stock")),
    costoUnitario: field(element, "costoUnitario"),
    precioVenta: field(element, "precioVenta"),
  };
}

function parseUser(element) {
  return {
    id: field(element, "id"),
    nombre: field(element, "nombre"),
    correo: field(element, "correo"),
    rol: field(element, "rol"),
    activo: field(element, "activo") === "true",
  };
}

function parseSale(element) {
  const itemWrapper = child(element, "items");
  const items = itemWrapper
    ? Array.from(itemWrapper.children).filter((item) => item.localName === "item")
    : Array.from(element?.getElementsByTagNameNS("*", "item") || []);
  const itemElements = items.length
    ? items
    : Array.from(element?.getElementsByTagNameNS("*", "item") || []);
  return {
    id: field(element, "id"),
    numero: field(element, "numero"),
    usuarioId: field(element, "usuarioId"),
    usuarioNombre: field(element, "usuarioNombre"),
    cantidadProductos: Number(field(element, "cantidadProductos")) || itemElements.length,
    fecha: field(element, "fecha"),
    total: field(element, "total"),
    estado: field(element, "estado"),
    items: itemElements.map((item) => ({
      loteId: descendantText(item, "loteId"),
      medicamentoId: descendantText(item, "medicamentoId"),
      medicamentoNombre: descendantText(item, "medicamentoNombre"),
      codigoLote: descendantText(item, "codigoLote"),
      cantidad: Number(descendantText(item, "cantidad")),
      precioUnitario: descendantText(item, "precioUnitario"),
      subtotal: descendantText(item, "subtotal"),
    })),
  };
}

function parseMovement(element) {
  return {
    id: field(element, "id"),
    loteId: field(element, "loteId"),
    ventaId: field(element, "ventaId"),
    usuarioId: field(element, "usuarioId"),
    usuarioNombre: field(element, "usuarioNombre"),
    usuarioRol: field(element, "usuarioRol"),
    tipo: field(element, "tipo"),
    cantidad: Number(field(element, "cantidad")),
    stockAntes: Number(field(element, "stockAntes")),
    stockDespues: Number(field(element, "stockDespues")),
    motivo: field(element, "motivo"),
    fecha: field(element, "fecha"),
  };
}

function parseSalePreview(element) {
  const allocations = Array.from(child(element, "allocations")?.children || [])
    .filter((item) => item.localName === "allocation")
    .map((item) => ({
      medicamentoId: field(item, "medicamentoId"),
      medicamentoNombre: field(item, "medicamentoNombre"),
      codigoLote: field(item, "codigoLote"),
      fechaVencimiento: field(item, "fechaVencimiento"),
      cantidad: Number(field(item, "cantidad")),
      existenciasDisponibles: Number(field(item, "existenciasDisponibles")),
      precioUnitario: field(item, "precioUnitario"),
      subtotal: field(item, "subtotal"),
    }));
  return { total: field(element, "total"), allocations };
}

async function listAll(operation, wrapper, itemName, filters = {}) {
  const items = [];
  let total = 0;
  do {
    const result = await soapCall(operation, { ...filters, limit: PAGE_SIZE, offset: items.length });
    items.push(...children(result, wrapper, itemName));
    total = Number(field(result, "total"));
    if (!children(result, wrapper, itemName).length) break;
  } while (items.length < total);
  return items;
}

function canManageSales() {
  return ["administrador", "vendedor"].includes(state.user?.rol);
}
function canManageCatalog() {
  return ["administrador", "farmaceutico"].includes(state.user?.rol);
}

function canAdministerUsers() {
  return state.user?.rol === "administrador";
}

function canReadInventoryMovements() {
  return ["administrador", "farmaceutico"].includes(state.user?.rol);
}

async function login(correo, password) {
  const result = await soapCall("Login", { correo, password }, false);
  const token = field(result, "token");
  const expiresInSeconds = Number(field(result, "expiresInSeconds")) || 2 * 60 * 60;
  const user = child(result, "user");
  if (!token || !user) throw new Error("El backend devolviÃƒÂ³ una sesiÃƒÂ³n incompleta.");
  state.token = token;
  state.user = parseUser(user);
  state.sessionExpiry = Date.now() + expiresInSeconds * 1000;
  state.sessionWarningShown = false;
  sessionStorage.setItem("verdesalud.session", token);
  await loadData();
}

async function loadData() {
  state.loading = true;
  await checkConnection();
  const [medications, batches, alerts, sales] = await Promise.all([
    listAll("ListMedications", "medications", "medication"),
    listAll("ListBatches", "batches", "batch"),
    listAll("ListExpirationAlerts", "alerts", "alert"),
    listAll("ListSales", "sales", "sale"),
  ]);
  state.medications = medications.map(parseMedication);
  state.batches = batches.map(parseBatch);
  state.alerts = alerts.map((element) => ({
    batch: parseBatch(child(element, "batch")),
    dias: Number(field(element, "diasParaVencer")),
  }));
  state.sales = sales.map(parseSale);
  if (canAdministerUsers()) {
    state.users = (await listAll("ListUsers", "users", "user")).map(parseUser);
  } else {
    state.users = [];
  }
  if (state.route === "inventario" && state.inventoryTab === "movimientos") {
    await loadMovements();
  }
  state.loading = false;
}

async function loadMovements(filters = state.movementFilters) {
  const operation = filters.loteId ? "ListInventoryMovementsByBatch" : "ListInventoryMovements";
  state.movements = (await listAll(operation, "movements", "movement", filters)).map(parseMovement);
  state.movementsLoaded = true;
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function salesPresetRange(period) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const end = dateInputValue(today);
  if (period === "today") return { fechaDesde: end, fechaHasta: end };
  if (period === "week") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { fechaDesde: dateInputValue(start), fechaHasta: end };
  }
  if (period === "month") {
    return { fechaDesde: dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1, 12)), fechaHasta: end };
  }
  return { fechaDesde: "", fechaHasta: "" };
}

function previousSalesRange(filters) {
  if (!filters.fechaDesde || !filters.fechaHasta) return null;
  const start = new Date(`${filters.fechaDesde}T12:00:00`);
  const end = new Date(`${filters.fechaHasta}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  const duration = Math.round((end - start) / 86_400_000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - duration + 1);
  return {
    fechaDesde: dateInputValue(previousStart),
    fechaHasta: dateInputValue(previousEnd),
  };
}

function salesPeriodActive(period) {
  const range = salesPresetRange(period);
  return range.fechaDesde === (state.salesFilters.fechaDesde || "")
    && range.fechaHasta === (state.salesFilters.fechaHasta || "");
}

function comparisonText(current, previous, comparable) {
  if (!comparable) return "Acumulado del historial";
  if (previous === 0) return current > 0 ? "Nuevo frente al periodo anterior" : "Sin variaciÃƒÂ³n";
  if (current === previous) return "Sin cambio frente al periodo anterior";
  const change = Math.round(((current - previous) / previous) * 100);
  return `${Math.abs(change)}% ${change > 0 ? "mÃƒÂ¡s" : "menos"} frente al periodo anterior`;
}

async function loadSalesHistory(filters = state.salesFilters) {
  const previousRange = previousSalesRange(filters);
  const orderedFilters = {
    estado: filters.estado || "",
    fechaDesde: filters.fechaDesde || "",
    fechaHasta: filters.fechaHasta || "",
    busqueda: filters.busqueda || "",
  };
  const currentRequest = listAll("ListSales", "sales", "sale", orderedFilters);
  const previousRequest = previousRange
    ? listAll("ListSales", "sales", "sale", { ...orderedFilters, ...previousRange })
    : Promise.resolve([]);
  const [current, previous] = await Promise.all([currentRequest, previousRequest]);
  state.sales = current.map(parseSale);
  state.salesPrevious = previous.map(parseSale);
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 })
    : "$ 0";
}

function formatDate(value) {
  if (!value) return "Ã¢â‚¬â€";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? escapeHTML(value)
    : date.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "Ã¢â‚¬â€";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? escapeHTML(value)
    : date.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

async function checkConnection() {
  try {
    const response = await fetch(HEALTH_URL, { cache: "no-store" });
    state.connection = response.ok ? "connected" : "degraded";
  } catch {
    state.connection = "offline";
  }
}

function skeletonRows(columns = 5, rows = 5) {
  return `<div class="table-skeleton" role="status" aria-label="Cargando datos">${Array.from({ length: rows }, () => `<div class="skeleton-row">${Array.from({ length: columns }, () => '<span class="skeleton-cell"></span>').join("")}</div>`).join("")}</div>`;
}

function sortValue(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  const numeric = Number(text.replace(/[,$.%\s]/g, ""));
  return text && Number.isFinite(numeric) ? numeric : text.toLocaleLowerCase("es");
}

function sortedRows(rows, scope, defaultKey = "") {
  const sort = state.tableSort[scope];
  if (!sort?.key) {
    if (!defaultKey) return rows;
    sortValue(defaultKey);
  }
  if (!sort?.key) return rows;
  const direction = sort.direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a[sort.key]);
    const right = sortValue(b[sort.key]);
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
    return 0;
  });
}

function pageRows(rows, scope, pageSize = 10) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(Number(state.pagination[scope]?.page || 1), 1), pageCount);
  state.pagination[scope] = { page: current, pageSize };
  const start = (current - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), current, pageCount, start, end: Math.min(start + pageSize, rows.length), total: rows.length };
}

function paginationBar(scope, pagination) {
  if (pagination.pageCount <= 1) return "";
  const pages = Array.from({ length: pagination.pageCount }, (_, index) => index + 1)
    .filter((page) => page === 1 || page === pagination.pageCount || Math.abs(page - pagination.current) <= 1);
  let previous = 0;
  const pageButtons = pages.map((page) => {
    const separator = previous && page - previous > 1 ? '<span class="pagination-gap">Ã¢â‚¬Â¦</span>' : "";
    previous = page;
    return `${separator}<button type="button" class="pagination-button ${page === pagination.current ? "active" : ""}" data-action="table-page" data-page="${page}" data-scope="${scope}" aria-label="PÃƒÂ¡gina ${page}">${page}</button>`;
  }).join("");
  return `<div class="pagination"><button type="button" class="pagination-button" data-action="table-page" data-page="${pagination.current - 1}" data-scope="${scope}" ${pagination.current === 1 ? "disabled" : ""}>Anterior</button><div class="pagination-pages">${pageButtons}</div><span class="pagination-summary">${pagination.start + 1}-${pagination.end} de ${pagination.total}</span><button type="button" class="pagination-button" data-action="table-page" data-page="${pagination.current + 1}" data-scope="${scope}" ${pagination.current === pagination.pageCount ? "disabled" : ""}>Siguiente</button></div>`;
}

function exportCsv(filename, headers, rows) {
  const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sortableHeading(scope, key, label) {
  const sort = state.tableSort[scope];
  const active = sort?.key === key;
  const direction = active ? sort.direction : "none";
  return `<th class="sortable-heading" aria-sort="${direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}"><button type="button" data-action="table-sort" data-scope="${scope}" data-key="${key}">${label}<span aria-hidden="true">${active ? (direction === "asc" ? " Ã¢â€ â€˜" : " Ã¢â€ â€œ") : " Ã¢â€ â€¢"}</span></button></th>`;
}

function stockTotal() {
  return state.batches.reduce((sum, batch) => sum + batch.stock, 0);
}

function brandMark() {
  return '<span class="brand-mark" aria-hidden="true"><span>V</span><span>S</span></span>';
}

function initials() {
  return (state.user?.nombre || "FS").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function renderLogin(error = "") {
  app.innerHTML = `
    <main class="login-layout">
      <section class="login-art" aria-label="Bienvenido a Farmacias Vital Salud">
        <div class="art-glow"></div>
        <div class="art-brand">${brandMark()}<span>Farmacias Vital Salud</span></div>
        <div class="art-copy">
          <span class="eyebrow">CUIDAMOS DE TI, TODOS LOS DÃƒÂAS</span>
          <h1>Tu farmacia,<br />mÃƒÂ¡s cerca.</h1>
          <p>Un espacio sencillo para cuidar cada detalle de tu operaciÃƒÂ³n.</p>
        </div>
        <div class="art-footer"><span class="art-check">${icon("check")}</span> GestiÃƒÂ³n clara. Cuidado cercano.</div>
      </section>
      <section class="login-panel">
        <div class="mobile-brand">${brandMark()}<span>Farmacias Vital Salud</span></div>
        <div class="login-card">
          <span class="eyebrow">PANEL DE GESTIÃƒâ€œN</span>
          <h2>QuÃƒÂ© bueno verte</h2>
          <p class="muted">Ingresa con tu cuenta para continuar.</p>
          <form id="login-form">
            <label for="email">Correo electrÃƒÂ³nico</label>
            <input id="email" name="email" type="email" placeholder="nombre@farmacia.com" autocomplete="username" required />
            <label for="password">ContraseÃƒÂ±a</label>
            <input id="password" name="password" type="password" placeholder="Tu contraseÃƒÂ±a" autocomplete="current-password" required />
            ${error ? `<div class="form-error" role="alert">${escapeHTML(error)}</div>` : ""}
            <button class="button button-primary login-button" type="submit">Iniciar sesiÃƒÂ³n <span>Ã¢â€ â€™</span></button>
          </form>
          <p class="login-note">Tu informaciÃƒÂ³n estÃƒÂ¡ protegida y solo disponible para tu equipo.</p>
        </div>
        <span class="login-copyright">Ã‚Â© 2026 Farmacias Vital Salud Ã‚Â· GestiÃƒÂ³n farmacÃƒÂ©utica</span>
      </section>
    </main>`;

  app.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> ConectandoÃ¢â‚¬Â¦';
    try {
      await login(String(form.get("email")).trim(), String(form.get("password")));
      renderShell();
    } catch (error) {
      state.token = "";
      state.user = null;
      sessionStorage.removeItem("verdesalud.session");
      renderLogin(error.message);
    }
  });
}

function navItem(route, label, iconName) {
  const active = state.route === route;
  const badge = route === "inventario" && state.alerts.length
    ? `<span class="nav-count">${state.alerts.length}</span>`
    : "";
  return `<button class="nav-link ${active ? "active" : ""}" data-route="${route}">${icon(iconName)}<span>${label}</span>${badge}</button>`;
}

function renderShell() {
  const titles = {
    inicio: "Resumen",
    medicamentos: "Medicamentos",
    inventario: "Inventario",
    bodegas: "Bodegas",
    ventas: "Ventas",
    movimientos: "Movimientos",
    usuarios: "Usuarios",
  };
  const menu = [
    ["inicio", "Resumen", "home"],
    ["medicamentos", "Medicamentos", "pills"],
    ["inventario", "Inventario", "box"],
    ["bodegas", "Bodegas", "warehouse"],
    ["ventas", "Ventas", "receipt"],
  ];
  if (canReadInventoryMovements()) menu.push(["movimientos", "Movimientos", "activity"]);
  if (canAdministerUsers()) menu.push(["usuarios", "Usuarios", "users"]);
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#" aria-label="Farmacias Vital Salud, inicio">${brandMark()}<span>Farmacias Vital Salud</span></a>
        <div class="nav-label">GESTIÃƒâ€œN FARMACÃƒâ€°UTICA</div>
        <nav class="navigation">${menu.map(([route, label, iconName]) => navItem(route, label, iconName)).join("")}</nav>
        <div class="sidebar-bottom">
          <div class="help-card"><span class="help-dot"></span><strong>SesiÃƒÂ³n activa</strong><p>Acceso segÃƒÂºn el rol ${escapeHTML(state.user.rol)}.</p></div>
          <button class="profile-button" id="logout">${userAvatar()}<span class="profile-info"><strong>${escapeHTML(state.user.nombre)}</strong><small>${escapeHTML(state.user.rol)}</small></span>${icon("logout", "logout-icon")}</button>
        </div>
      </aside>
      <main class="main-area">
        <header class="topbar"><div class="mobile-brand">${brandMark()}<span>Farmacias Vital Salud</span></div><div class="breadcrumb">Panel <span>/</span> <strong>${titles[state.route]}</strong></div><div class="topbar-right"><span class="connection-status ${state.connection}" title="${state.connection === "connected" ? "Backend y base de datos disponibles" : "ConexiÃƒÂ³n no disponible"}"><i></i>${state.connection === "connected" ? "Conectado" : state.connection === "checking" ? "Verificando" : "Sin conexiÃƒÂ³n"}</span><span class="today">${new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}</span><button type="button" class="mobile-logout" id="mobile-logout" aria-label="Cerrar sesiÃƒÂ³n" title="Cerrar sesiÃƒÂ³n">${icon("logout")}</button><span class="topbar-avatar">${initials()}</span></div></header>
        <section class="page-content">${renderRoute()}</section>
      </main>
      ${state.toast ? `<div class="toast" role="status">${icon("check")}${escapeHTML(state.toast)}</div>` : ""}
      ${renderModal()}
    </div>`;

  app.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", async () => {
    state.route = button.dataset.route;
    state.search = "";
    if (state.route === "movimientos") {
      try {
        await loadMovements();
      } catch (error) {
        notify(error.message);
      }
    }
    renderShell();
  }));
  const logout = () => {
    state.token = "";
    state.user = null;
    sessionStorage.removeItem("verdesalud.session");
    renderLogin();
  };
  app.querySelector("#logout").addEventListener("click", logout);
  app.querySelector("#mobile-logout").addEventListener("click", logout);
  if (state.modal) {
    window.setTimeout(() => {
      const modal = app.querySelector(".modal");
      const preferred = modal?.querySelector("input:not([type='hidden']), select, button");
      preferred?.focus();
    }, 0);
  }
}

function userAvatar() {
  return `<span class="profile-avatar">${initials()}</span>`;
}

function renderRoute() {
  if (state.loading) return `<section class="loading-route" aria-busy="true" aria-label="Cargando informaciÃƒÂ³n">${skeletonRows(4, 2)}<div class="dashboard-skeleton-grid">${skeletonRows(5, 4)}${skeletonRows(3, 5)}</div></section>`;
  if (state.route === "bodegas") return renderNotFound();
  if (state.route === "medicamentos") return renderMedications();
  if (state.route === "inventario") return state.inventoryTab === "movimientos" && canReadInventoryMovements()
    ? renderMovements()
    : renderBatches();
  if (state.route === "movimientos") return renderMovements();
  if (state.route === "ventas") return renderSales();
  if (state.route === "usuarios" && canAdministerUsers()) return renderUsers();
  return renderDashboard();
}

function renderNotFound() {
  return `
    <section class="not-found-page" aria-labelledby="not-found-title">
      <div class="not-found-card">
        <div class="not-found-copy">
          <span class="eyebrow">ERROR 404 Ã‚Â· SECCIÃƒâ€œN NO DISPONIBLE</span>
          <div class="not-found-code" aria-hidden="true">404</div>
          <h1 id="not-found-title">Ã‚Â¡Ups! No encontramos esta bodega.</h1>
          <p>La direcciÃƒÂ³n que buscas no estÃƒÂ¡ disponible. Esta secciÃƒÂ³n es una demostraciÃƒÂ³n de una pÃƒÂ¡gina de error; puedes volver al panel y continuar gestionando tu farmacia.</p>
          <div class="not-found-actions">
            <button type="button" class="button button-primary" data-route="inicio">${icon("home")}Volver al resumen</button>
            <button type="button" class="button button-soft" data-route="inventario">${icon("box")}Ver inventario</button>
          </div>
          <span class="not-found-note">Tranquilo, tus medicamentos y existencias siguen a salvo.</span>
        </div>
        <div class="not-found-illustration" aria-hidden="true">
          <span class="not-found-sun"></span>
          <span class="not-found-orbit"></span>
          <span class="not-found-number">404</span>
          <div class="not-found-warehouse">${icon("warehouse")}</div>
          <div class="not-found-package package-left"></div>
          <div class="not-found-package package-right"></div>
          <span class="not-found-ground"></span>
          <span class="not-found-caption">DESTINO NO ENCONTRADO</span>
        </div>
      </div>
    </section>`;
}

function pageHeading(eyebrow, title, description, action = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function metricCard(label, value, note, iconName, tone) {
  return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon ${tone}">${icon(iconName)}</span></div><strong class="metric-value">${value}</strong><span class="metric-note">${note}</span></article>`;
}

function button(label, action, className = "button button-primary", iconName = "") {
  return `<button class="${className}" data-action="${action}">${iconName ? icon(iconName) : ""}${label}</button>`;
}

function renderDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const todaySales = state.sales.filter((sale) => sale.estado === "confirmada" && String(sale.fecha).slice(0, 10) === today);
  const totalToday = todaySales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const lowStock = state.batches.filter((batch) => batch.stock > 0 && batch.stock <= 10).length;
  const chartDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const key = dateInputValue(date);
    const sales = state.sales.filter((sale) => sale.estado === "confirmada" && String(sale.fecha).slice(0, 10) === key);
    return {
      label: date.toLocaleDateString("es-CO", { weekday: "short" }).replace(".", "").slice(0, 2),
      total: sales.reduce((sum, sale) => sum + Number(sale.total), 0),
      count: sales.length,
    };
  });
  const chartMax = Math.max(...chartDays.map((day) => day.total), 1);
  const recentSales = state.sales.slice(0, 5);
  const alertRows = state.alerts.slice(0, 4);
  return `
    ${pageHeading("FARMASALUD POPAYÃƒÂN", `Hola, ${escapeHTML((state.user.nombre || "").split(" ")[0])} Ã°Å¸â€˜â€¹`, "Tu operaciÃƒÂ³n, inventario y equipo en un solo lugar.", button("Actualizar datos", "refresh", "button button-soft", "arrow"))}
    <div class="metric-grid">
      ${metricCard("Medicamentos activos", state.medications.filter((item) => item.activo).length, "En tu catÃƒÂ¡logo", "pills", "green")}
      ${metricCard("Unidades disponibles", stockTotal().toLocaleString("es-CO"), `${lowStock} lotes con stock bajo`, "box", "blue")}
      ${metricCard("Por vencer", state.alerts.length, state.alerts.length ? "Revisa las alertas de inventario" : "Sin alertas de vencimiento", "receipt", "amber")}
      ${metricCard("Ventas de hoy", formatMoney(totalToday), `${todaySales.length} transacciones confirmadas`, "arrow", "violet")}
    </div>
    <section class="panel sales-chart-panel">
      <div class="panel-heading"><div><h2>Ventas de los ÃƒÂºltimos 7 dÃƒÂ­as</h2><p>Valor confirmado por dÃƒÂ­a</p></div><span class="chart-total">${formatMoney(chartDays.reduce((sum, day) => sum + day.total, 0))}</span></div>
      <div class="sales-chart" role="img" aria-label="GrÃƒÂ¡fico de ventas de los ÃƒÂºltimos siete dÃƒÂ­as">${chartDays.map((day) => `<div class="chart-column"><span class="chart-value">${day.count ? formatMoney(day.total) : "Ã¢â‚¬â€"}</span><div class="chart-track"><span style="height:${day.total ? Math.max(8, (day.total / chartMax) * 100) : 2}%"></span></div><strong>${day.label}</strong></div>`).join("")}</div>
    </section>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-heading"><div><h2>Ventas recientes</h2><p>ÃƒÅ¡ltimas transacciones registradas</p></div><button class="text-button" data-route="ventas">Ver todas <span>Ã¢â€ â€™</span></button></div>
        ${recentSales.length ? `<div class="table-wrap"><table><thead><tr><th>VENTA</th><th>FECHA</th><th>ESTADO</th><th class="align-right">TOTAL</th></tr></thead><tbody>${recentSales.map(saleRow).join("")}</tbody></table></div>` : emptyState("AÃƒÂºn no hay ventas", "Cuando se registren ventas, aparecerÃƒÂ¡n aquÃƒÂ­.")}
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>AtenciÃƒÂ³n prÃƒÂ³xima</h2><p>Lotes que requieren seguimiento</p></div>${state.alerts.length ? `<span class="count-pill">${state.alerts.length}</span>` : ""}</div>
        ${alertRows.length ? `<div class="alert-list">${alertRows.map(alertRow).join("")}</div><button class="text-button panel-link" data-route="inventario">Revisar inventario <span>Ã¢â€ â€™</span></button>` : emptyState("Todo al dÃƒÂ­a", "No hay lotes prÃƒÂ³ximos a vencer.")}
      </section>
    </div>
    <div class="connection-note">${icon("check")} Datos conectados con tu backend de farmacia.</div>`;
}

function saleRow(sale) {
  return `<tr><td><strong class="table-primary">${escapeHTML(sale.numero)}</strong></td><td>${formatDate(sale.fecha)}</td><td><span class="status ${sale.estado === "confirmada" ? "status-good" : "status-neutral"}">${escapeHTML(sale.estado)}</span></td><td class="align-right"><strong>${formatMoney(sale.total)}</strong></td></tr>`;
}

function alertRow(alert) {
  const expired = alert.dias < 0;
  const daysLabel = expired ? "Vencido" : alert.dias === 0 ? "Vence hoy" : `${alert.dias} dÃƒÂ­as`;
  return `<div class="alert-row"><span class="alert-symbol ${expired ? "expired" : ""}">!</span><div class="alert-detail"><strong>${escapeHTML(alert.batch.medicamentoNombre)}</strong><span>Lote ${escapeHTML(alert.batch.codigoLote)} Ã‚Â· ${formatDate(alert.batch.fechaVencimiento)}</span></div><span class="alert-days ${expired ? "expired" : ""}">${daysLabel}</span></div>`;
}

function renderMedications() {
  const query = normalizeSearchText(state.search).trim();
  const medications = state.medications.filter((item) =>
    normalizeSearchText(`${item.nombre} ${item.codigo} ${item.principioActivo}`).includes(query));
  const medicationPage = pageRows(sortedRows(medications, "medications"), "medications", 10);
  const action = canManageCatalog() ? button("Agregar medicamento", "new-medication", "button button-primary", "plus") : "";
  return `
    ${pageHeading("CATÃƒÂLOGO", "Medicamentos", `${state.medications.length} registros en tu catÃƒÂ¡logo.`, action)}
    <section class="panel list-panel">
      <div class="list-toolbar"><div><h2>CatÃƒÂ¡logo de medicamentos</h2><p>Consulta, registra y actualiza productos.</p></div><div class="toolbar-actions"><div class="catalog-search"><label class="search-field">${icon("search")}<input id="medicine-search" type="search" value="${escapeHTML(state.search)}" placeholder="Nombre, cÃƒÂ³digo o principio activo..." aria-label="Buscar por nombre, cÃƒÂ³digo o principio activo" autocomplete="off" /></label><span class="search-result-count" role="status">${query ? `${medications.length} ${medications.length === 1 ? "resultado" : "resultados"}` : `${state.medications.length} medicamentos`}</span></div><button class="button button-soft export-button" type="button" data-action="export-medications">${icon("print")}Exportar Excel</button></div></div>
      ${medications.length ? `<div class="table-wrap"><table class="responsive-table"><thead><tr>${sortableHeading("medications", "nombre", "MEDICAMENTO")}${sortableHeading("medications", "codigo", "CÃƒâ€œDIGO")}${sortableHeading("medications", "principioActivo", "PRINCIPIO ACTIVO")}${sortableHeading("medications", "presentacion", "PRESENTACIÃƒâ€œN")}${sortableHeading("medications", "precioReferencia", "PRECIO REF.")}<th>FÃƒâ€œRMULA</th>${sortableHeading("medications", "activo", "ESTADO")}<th>ACCIONES</th></tr></thead><tbody>${medicationPage.rows.map((item) => `<tr><td data-label="Medicamento"><strong class="table-primary">${escapeHTML(item.nombre)}</strong></td><td data-label="CÃƒÂ³digo">${escapeHTML(item.codigo)}</td><td data-label="Principio activo">${escapeHTML(item.principioActivo)}</td><td data-label="PresentaciÃƒÂ³n">${escapeHTML(item.presentacion)}</td><td data-label="Precio ref.">${formatMoney(item.precioReferencia)}</td><td data-label="FÃƒÂ³rmula">${item.requiereFormula ? "Requiere" : "Libre"}</td><td data-label="Estado"><span class="status ${item.activo ? "status-good" : "status-neutral"}">${item.activo ? "Activo" : "Inactivo"}</span></td><td data-label="Acciones" class="actions-cell"><button class="icon-button" data-action="view-medication" data-id="${escapeHTML(item.id)}" aria-label="Ver medicamento">${icon("eye")}</button>${canManageCatalog() ? `<button class="icon-button" data-action="edit-medication" data-id="${escapeHTML(item.id)}" aria-label="Editar medicamento">${icon("edit")}</button>` : ""}${state.user.rol === "administrador" ? item.activo ? `<button class="icon-button danger-icon" data-action="deactivate-medication" data-id="${escapeHTML(item.id)}" aria-label="Desactivar medicamento">${icon("close")}</button>` : `<button class="button button-soft activate-button" data-action="activate-medication" data-id="${escapeHTML(item.id)}" aria-label="Reactivar medicamento">${icon("check")}Reactivar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>${paginationBar("medications", medicationPage)}` : emptyState(query ? "No encontramos resultados" : "AÃƒÂºn no hay medicamentos", query ? "Prueba con otro nombre, cÃƒÂ³digo o principio activo." : canManageCatalog() ? "Agrega el primer producto de tu catÃƒÂ¡logo." : "Los medicamentos registrados aparecerÃƒÂ¡n aquÃƒÂ­.")}
    </section>
    <p class="list-footnote">Consulta hasta ${state.medications.length} medicamentos registrados.</p>`;
}

function inventoryTabs() {
  const tabs = `<button class="tab-button ${state.inventoryTab === "lotes" ? "active" : ""}" data-action="inventory-tab" data-tab="lotes">Lotes y existencias</button>`;
  return tabs + (canReadInventoryMovements()
    ? `<button class="tab-button ${state.inventoryTab === "movimientos" ? "active" : ""}" data-action="inventory-tab" data-tab="movimientos">Movimientos</button>`
    : "");
}

function renderBatches() {
  const query = normalizeSearchText(state.batchSearch).trim();
  const batches = state.batches.filter((batch) =>
    normalizeSearchText(`${batch.medicamentoNombre} ${batch.codigoLote}`).includes(query));
  const medicationsWithoutBatches = matchingMedicationsWithoutBatches(state.medications, state.batches, query);
  const batchPage = pageRows(sortedRows(batches, "batches"), "batches", 10);
  const action = canManageCatalog() ? button("Registrar lote", "new-batch", "button button-primary", "plus") : "";
  const emptyTitle = query
    ? medicationsWithoutBatches.length ? "Medicamento sin lotes" : "No encontramos lotes"
    : "Sin lotes registrados";
  const medicationNames = medicationsWithoutBatches.map((medication) => medication.nombre).join(", ");
  const emptyMessage = query
    ? medicationsWithoutBatches.length
      ? `${medicationsWithoutBatches.length === 1 ? "El medicamento" : "Los medicamentos"} ${medicationNames} ${medicationsWithoutBatches.length === 1 ? "estÃƒÂ¡" : "estÃƒÂ¡n"} en el catÃƒÂ¡logo, pero no tiene${medicationsWithoutBatches.length === 1 ? "" : "n"} lotes registrados. ${canManageCatalog() ? "Registra un lote para agregar existencias." : "Solicita a un administrador o farmacÃ©utico que registre un lote."}`
      : "Prueba con otro medicamento o cÃƒÂ³digo de lote."
    : canManageCatalog()
      ? "Registra un lote para comenzar a controlar las existencias."
      : "Los lotes registrados en el backend aparecerÃƒÂ¡n en esta tabla.";
  return `
    ${pageHeading("CONTROL DE EXISTENCIAS", "Inventario", `${state.batches.length} lotes Ã‚Â· ${stockTotal().toLocaleString("es-CO")} unidades disponibles.`, action)}
    <div class="tab-row">${inventoryTabs()}</div>
    ${state.alerts.length ? `<section class="alert-banner"><span class="banner-icon">!</span><div><strong>${state.alerts.length} ${state.alerts.length === 1 ? "lote requiere" : "lotes requieren"} atenciÃƒÂ³n</strong><p>Hay productos vencidos o prÃƒÂ³ximos a vencer en los siguientes 30 dÃƒÂ­as.</p></div></section>` : ""}
    <section class="panel list-panel">
      <div class="list-toolbar"><div><h2>Lotes de inventario</h2><p>Existencias ordenadas por fecha de vencimiento.</p></div><div class="toolbar-actions"><label class="search-field">${icon("search")}<input id="batch-search" type="search" value="${escapeHTML(state.batchSearch)}" placeholder="Buscar medicamento o lote..." aria-label="Buscar lotes" /></label><button class="button button-soft export-button" type="button" data-action="export-batches">${icon("print")}Exportar Excel</button></div></div>
      ${batches.length ? `<div class="table-wrap"><table class="responsive-table"><thead><tr>${sortableHeading("batches", "medicamentoNombre", "MEDICAMENTO")}${sortableHeading("batches", "codigoLote", "CÃƒâ€œDIGO DE LOTE")}${sortableHeading("batches", "fechaVencimiento", "VENCIMIENTO")}${sortableHeading("batches", "stock", "UNIDADES")}${sortableHeading("batches", "costoUnitario", "COSTO")}${sortableHeading("batches", "precioVenta", "PRECIO")}<th>DISPONIBILIDAD</th><th>ACCIONES</th></tr></thead><tbody>${batchPage.rows.map((batch) => `<tr><td data-label="Medicamento"><strong class="table-primary">${escapeHTML(batch.medicamentoNombre)}</strong></td><td data-label="Lote">${escapeHTML(batch.codigoLote)}</td><td data-label="Vencimiento">${formatDate(batch.fechaVencimiento)}</td><td data-label="Unidades"><strong>${batch.stock.toLocaleString("es-CO")}</strong></td><td data-label="Costo">${formatMoney(batch.costoUnitario)}</td><td data-label="Precio">${formatMoney(batch.precioVenta)}</td><td data-label="Disponibilidad">${batchStatus(batch)}</td><td data-label="Acciones" class="actions-cell"><button class="icon-button" data-action="view-batch" data-id="${escapeHTML(batch.id)}" aria-label="Ver lote">${icon("eye")}</button>${canManageCatalog() ? `<button class="icon-button" data-action="edit-batch" data-id="${escapeHTML(batch.id)}" aria-label="Editar lote">${icon("edit")}</button>` : ""}${state.user.rol === "administrador" ? `<button class="icon-button danger-icon" data-action="delete-batch" data-id="${escapeHTML(batch.id)}" aria-label="Eliminar lote">${icon("trash")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>${paginationBar("batches", batchPage)}` : emptyState(emptyTitle, emptyMessage)}
    </section>
    ${state.alerts.length ? `<section class="panel alerts-panel"><div class="panel-heading"><div><h2>Alertas de vencimiento</h2><p>Lotes vencidos o con vencimiento prÃƒÂ³ximo.</p></div></div><div class="alert-list">${state.alerts.map(alertRow).join("")}</div></section>` : ""}`;
}

function batchStatus(batch) {
  if (batch.stock <= 0) return '<span class="status status-neutral">Agotado</span>';
  if (batch.stock <= 10) return '<span class="status status-warning">Stock bajo</span>';
  return '<span class="status status-good">Disponible</span>';
}

function renderMovements() {
  const action = state.route === "inventario" ? `<div class="tab-row">${inventoryTabs()}</div>` : "";
  const movementRows = state.movements.map((item, index) => {
    const isLatest = index === 0;
    const latestLabel = isLatest ? '<span class="movement-latest-label">MÃƒÂ¡s reciente</span>' : "";
    const typeTone = item.tipo === "entrada" || item.tipo === "reversiÃƒÂ³n"
      ? "status-good"
      : item.tipo === "ajuste" ? "status-warning" : "status-neutral";
    return `<tr class="${isLatest ? "movement-latest-row" : ""}"><td>${formatDateTime(item.fecha)}${latestLabel}</td><td>${escapeHTML(item.loteId)}</td><td>${escapeHTML(item.ventaId || "Ã¢â‚¬â€")}</td><td><span class="status ${typeTone}">${escapeHTML(item.tipo)}</span></td><td>${item.cantidad}</td><td>${item.stockAntes}</td><td>${item.stockDespues}</td><td>${escapeHTML(item.motivo)}</td><td><span class="user-display"><strong>${escapeHTML(item.usuarioNombre || "Usuario no disponible")}</strong><small>${escapeHTML(item.usuarioRol || "Rol no disponible")}</small></span></td></tr>`;
  }).join("");
  return `
    ${pageHeading("TRAZABILIDAD", "Movimientos de inventario", `${state.movements.length} movimientos encontrados.`)}
    ${action}
    <section class="panel filters-panel">
      <form id="movement-filter" class="filter-form">
        <label>Lote<select name="loteId"><option value="">Todos los lotes</option>${state.batches.map((batch) => `<option value="${escapeHTML(batch.id)}" ${state.movementFilters.loteId === batch.id ? "selected" : ""}>${escapeHTML(batch.codigoLote)} Ã‚Â· ${escapeHTML(batch.medicamentoNombre)}</option>`).join("")}</select></label>
        <label>Venta ID<input name="ventaId" inputmode="numeric" value="${escapeHTML(state.movementFilters.ventaId || "")}" placeholder="Opcional" /></label>
        <label>Tipo<select name="tipo"><option value="">Todos</option>${["entrada", "salida", "ajuste", "reversiÃƒÂ³n"].map((item) => `<option ${state.movementFilters.tipo === item ? "selected" : ""}>${item}</option>`).join("")}</select></label>
        <label>Desde<input name="fechaDesde" type="date" value="${escapeHTML(state.movementFilters.fechaDesde || "")}" /></label>
        <label>Hasta<input name="fechaHasta" type="date" value="${escapeHTML(state.movementFilters.fechaHasta || "")}" /></label>
        <button class="button button-primary" type="submit">Filtrar</button>
      </form>
    </section>
    <section class="panel list-panel">
      ${state.movements.length ? `<div class="table-wrap"><table class="movement-table"><thead><tr><th>FECHA</th><th>LOTE</th><th>VENTA</th><th>TIPO</th><th>CANTIDAD</th><th>STOCK ANTES</th><th>STOCK DESPUÃƒâ€°S</th><th>MOTIVO</th><th>REALIZADO POR</th></tr></thead><tbody>${movementRows}</tbody></table></div>` : emptyState("No hay movimientos", "Al registrar lotes, ajustes o ventas, verÃƒÂ¡s su historial aquÃƒÂ­.")}
    </section>`;
}

function renderSales() {
  const confirmed = state.sales.filter((sale) => sale.estado === "confirmada");
  const reversed = state.sales.filter((sale) => sale.estado === "revertida");
  const total = confirmed.reduce((sum, sale) => sum + Number(sale.total), 0);
  const previousConfirmed = state.salesPrevious.filter((sale) => sale.estado === "confirmada");
  const previousReversed = state.salesPrevious.filter((sale) => sale.estado === "revertida");
  const previousTotal = previousConfirmed.reduce((sum, sale) => sum + Number(sale.total), 0);
  const average = confirmed.length ? total / confirmed.length : 0;
  const previousAverage = previousConfirmed.length ? previousTotal / previousConfirmed.length : 0;
  const comparable = Boolean(previousSalesRange(state.salesFilters));
  const salesPage = pageRows(sortedRows(state.sales, "sales"), "sales", 10);
  const action = canManageSales() ? button("Nueva venta", "new-sale", "button button-primary", "plus") : "";
  return `
    ${pageHeading("MOVIMIENTO COMERCIAL", "Ventas", `${state.sales.length} transacciones registradas.`, action)}
    <div class="sales-summary">
      ${metricCard("Ventas confirmadas", confirmed.length, comparisonText(confirmed.length, previousConfirmed.length, comparable), "check", "green")}
      ${metricCard("Ventas revertidas", reversed.length, comparisonText(reversed.length, previousReversed.length, comparable), "arrow", "amber")}
      ${metricCard("Ventas netas", formatMoney(total), comparisonText(total, previousTotal, comparable), "activity", "blue")}
      ${metricCard("Ticket promedio", formatMoney(average), comparisonText(average, previousAverage, comparable), "receipt", "violet")}
    </div>
    <section class="panel list-panel">
      <div class="sales-toolbar">
        <div><h2>Historial de ventas</h2><p>Consulta y administra las transacciones registradas.</p></div>
        <div class="toolbar-actions"><span class="sales-result-count">${state.sales.length} ${state.sales.length === 1 ? "registro" : "registros"}</span><button class="button button-soft export-button" type="button" data-action="export-sales">${icon("print")}Exportar Excel</button></div>
      </div>
      <div class="sales-period-presets" aria-label="Periodos rÃƒÂ¡pidos">
        <span>Periodo</span>
        <button type="button" class="sales-period-button ${salesPeriodActive("today") ? "active" : ""}" data-action="sales-period" data-period="today">Hoy</button>
        <button type="button" class="sales-period-button ${salesPeriodActive("week") ? "active" : ""}" data-action="sales-period" data-period="week">ÃƒÅ¡ltimos 7 dÃƒÂ­as</button>
        <button type="button" class="sales-period-button ${salesPeriodActive("month") ? "active" : ""}" data-action="sales-period" data-period="month">Este mes</button>
        <button type="button" class="sales-period-button ${salesPeriodActive("all") ? "active" : ""}" data-action="sales-period" data-period="all">Todo</button>
      </div>
      <form id="sales-filter" class="sales-filters">
        <label class="sales-search-field">${icon("search")}<input type="search" name="busqueda" value="${escapeHTML(state.salesFilters.busqueda || "")}" placeholder="Venta, medicamento o usuario..." aria-label="Buscar ventas" /></label>
        <div class="sales-filter-fields">
          <label>Estado<select name="estado"><option value="" ${!state.salesFilters.estado ? "selected" : ""}>Todos los estados</option><option value="confirmada" ${state.salesFilters.estado === "confirmada" ? "selected" : ""}>Confirmada</option><option value="revertida" ${state.salesFilters.estado === "revertida" ? "selected" : ""}>Revertida</option></select></label>
          <label>Desde<input name="fechaDesde" type="date" value="${escapeHTML(state.salesFilters.fechaDesde || "")}" /></label>
          <label>Hasta<input name="fechaHasta" type="date" value="${escapeHTML(state.salesFilters.fechaHasta || "")}" /></label>
        </div>
        <button class="button button-soft" type="submit">${icon("search")}Aplicar</button>
      </form>
      ${state.sales.length ? `<div class="table-wrap"><table class="responsive-table"><thead><tr>${sortableHeading("sales", "numero", "NÃƒÅ¡MERO DE VENTA")}${sortableHeading("sales", "fecha", "FECHA Y HORA")}${sortableHeading("sales", "usuarioNombre", "ATENDIÃƒâ€œ")}${sortableHeading("sales", "cantidadProductos", "PRODUCTOS")}${sortableHeading("sales", "estado", "ESTADO")}${sortableHeading("sales", "total", "TOTAL")}<th>ACCIONES</th></tr></thead><tbody>${salesPage.rows.map((sale) => `<tr><td data-label="Venta"><strong class="table-primary sales-number" title="${escapeHTML(sale.numero)}">${escapeHTML(sale.numero)}</strong></td><td data-label="Fecha"><span class="sales-date"><strong>${formatDate(sale.fecha)}</strong><small>${formatTime(sale.fecha)}</small></span></td><td data-label="AtendiÃƒÂ³"><span class="sales-user">${escapeHTML(sale.usuarioNombre || `Usuario #${sale.usuarioId}`)}</span></td><td data-label="Productos"><span class="sales-product-count">${sale.cantidadProductos} ${sale.cantidadProductos === 1 ? "producto" : "productos"}</span></td><td data-label="Estado"><span class="status ${sale.estado === "confirmada" ? "status-good" : "status-neutral"}">${escapeHTML(sale.estado)}</span></td><td data-label="Total" class="align-right"><strong class="sales-total">${formatMoney(sale.total)}</strong></td><td data-label="Acciones" class="actions-cell"><button type="button" class="icon-button" data-action="view-sale" data-id="${escapeHTML(sale.id)}" aria-label="Ver detalle">${icon("eye")}</button>${state.user.rol === "administrador" && sale.estado === "confirmada" ? `<button type="button" class="button button-danger sale-reverse-button" data-action="reverse-sale" data-id="${escapeHTML(sale.id)}" aria-label="Revertir venta">${icon("undo")}Revertir venta</button>` : ""}</td></tr>`).join("")}</tbody></table></div>${paginationBar("sales", salesPage)}` : emptyState("AÃƒÂºn no hay ventas", canManageCatalog() ? "Registra una venta para actualizar el inventario automÃƒÂ¡ticamente." : "Las transacciones registradas aparecerÃƒÂ¡n aquÃƒÂ­.")}
    </section>`;
}

function renderUsers() {
  const users = state.users.filter((user) => {
    const roleMatches = !state.userFilters.rol || user.rol === state.userFilters.rol;
    const activeMatches = state.userFilters.activo === "" || user.activo === (state.userFilters.activo === "true");
    return roleMatches && activeMatches;
  });
  const userPage = pageRows(sortedRows(users, "users"), "users", 10);
  const action = button("Crear usuario", "new-user", "button button-primary", "plus");
  return `
    ${pageHeading("EQUIPO Y ACCESOS", "AdministraciÃƒÂ³n de usuarios", `${state.users.length} cuentas registradas.`, action)}
    <div class="role-explainer"><strong>Roles del sistema</strong><span>Administrador: control total</span><span>Farmacéutico: medicamentos y lotes</span><span>Vendedor: medicamentos, existencias y ventas</span><span>Un mismo rol puede asignarse a varios usuarios.</span></div>
    <section class="panel list-panel">
      <div class="list-toolbar"><div><h2>Usuarios del sistema</h2><p>Gestiona accesos, roles y estado de las cuentas.</p></div><form id="user-filter" class="inline-filter"><label>Rol<select name="rol"><option value="">Todos los roles</option>${ROLES.map((role) => `<option value="${role}" ${state.userFilters.rol === role ? "selected" : ""}>${role}</option>`).join("")}</select></label><label>Estado<select name="activo"><option value="" ${state.userFilters.activo === "" ? "selected" : ""}>Todos</option><option value="true" ${state.userFilters.activo === "true" ? "selected" : ""}>Activo</option><option value="false" ${state.userFilters.activo === "false" ? "selected" : ""}>Inactivo</option></select></label><button class="button button-soft" type="submit">Filtrar</button></form></div>
      ${users.length ? `<div class="table-wrap"><table class="responsive-table"><thead><tr>${sortableHeading("users", "nombre", "NOMBRE")}${sortableHeading("users", "correo", "CORREO")}${sortableHeading("users", "rol", "ROL")}${sortableHeading("users", "activo", "ESTADO")}<th>ACCIONES</th></tr></thead><tbody>${userPage.rows.map((user) => `<tr><td data-label="Nombre"><strong class="table-primary">${escapeHTML(user.nombre)}</strong></td><td data-label="Correo">${escapeHTML(user.correo)}</td><td data-label="Rol"><span class="role-pill">${escapeHTML(user.rol)}</span></td><td data-label="Estado"><span class="status ${user.activo ? "status-good" : "status-neutral"}">${user.activo ? "Activo" : "Inactivo"}</span></td><td data-label="Acciones" class="actions-cell"><button class="icon-button" data-action="view-user" data-id="${escapeHTML(user.id)}" aria-label="Ver usuario">${icon("eye")}</button><button class="icon-button" data-action="edit-user" data-id="${escapeHTML(user.id)}" aria-label="Editar usuario">${icon("edit")}</button>${user.activo ? user.id !== state.user.id ? `<button class="icon-button danger-icon" data-action="deactivate-user" data-id="${escapeHTML(user.id)}" aria-label="Desactivar usuario">${icon("close")}</button>` : "" : `<button class="button button-soft activate-button" data-action="activate-user" data-id="${escapeHTML(user.id)}" aria-label="Reactivar usuario">${icon("check")}Reactivar</button>`}</td></tr>`).join("")}</tbody></table></div>${paginationBar("users", userPage)}` : emptyState("Sin resultados", "Ajusta los filtros o crea un usuario nuevo.")}
    </section>`;
}

function emptyState(title, message) {
  return `<div class="empty-state"><span class="empty-icon">${icon("search")}</span><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p></div>`;
}

function modalShell(title, content, subtitle = "", className = "") {
  const backdropClass = className ? `${className}-backdrop` : "";
  return `<div class="modal-backdrop ${backdropClass}" data-action="close-modal"><section class="modal ${className}" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><header class="modal-header"><div><h2>${escapeHTML(title)}</h2>${subtitle ? `<p>${escapeHTML(subtitle)}</p>` : ""}</div><button type="button" class="icon-button" data-action="close-modal" aria-label="Cerrar">${icon("close")}</button></header>${content}</section></div>`;
}

function formError() {
  return state.modalError ? `<div class="form-error modal-error" role="alert">${escapeHTML(state.modalError)}</div>` : "";
}

function medicationFields(item = {}) {
  return `
    <label>CÃƒÂ³digo<input name="codigo" maxlength="50" value="${escapeHTML(item.codigo || "")}" required /></label>
    <label>Nombre del medicamento<input name="nombre" maxlength="150" value="${escapeHTML(item.nombre || "")}" required /></label>
    <label>Principio activo<input name="principioActivo" maxlength="150" value="${escapeHTML(item.principioActivo || "")}" required /></label>
    <label>PresentaciÃƒÂ³n<input name="presentacion" maxlength="120" value="${escapeHTML(item.presentacion || "")}" placeholder="Ej. Tabletas x 500 mg" required /></label>
    <label>Precio de referencia<input name="precioReferencia" type="number" min="0" step="0.01" value="${escapeHTML(item.precioReferencia || "0")}" required /></label>
    <label class="check-label"><input name="requiereFormula" type="checkbox" ${item.requiereFormula ? "checked" : ""} /> Requiere fÃƒÂ³rmula mÃƒÂ©dica</label>`;
}

function userFields(user = {}, creating = false, draft = {}) {
  const name = draft.nombre ?? user.nombre ?? "";
  const username = draft.usuario ?? (user.correo || "").split("@")[0];
  const selectedRole = draft.rol ?? user.rol ?? (creating ? "" : "vendedor");
  const usernameStatus = getUsernameStatus(username, user.id);
  return `
    <label>Nombre completo<input name="nombre" data-user-full-name maxlength="120" value="${escapeHTML(name)}" required /></label>
    <label>Usuario de acceso (ÃƒÂºnico)
      <span class="email-composer"><input id="user-username" name="usuario" type="text" inputmode="email" autocapitalize="none" autocomplete="off" maxlength="64" pattern="[A-Za-z0-9._+\\x2d]+" value="${escapeHTML(username)}" placeholder="vendedor" required /><span class="email-domain">@farmacia.com</span></span>
      <span class="email-preview">El correo quedarÃƒÂ¡ como <strong data-email-preview>${escapeHTML(username || "usuario")}@farmacia.com</strong></span>
      <span class="field-help user-availability ${usernameStatus.conflict ? "user-availability-error" : ""}" data-user-availability role="status">${escapeHTML(usernameStatus.message)}</span>
    </label>
    <label>Rol (puede repetirse)<select name="rol" required>${creating ? `<option value="" disabled ${selectedRole ? "" : "selected"}>Selecciona un rol</option>` : ""}${ROLES.map((role) => `<option value="${role}" ${selectedRole === role ? "selected" : ""}>${role}</option>`).join("")}</select></label>
    <label>ContraseÃƒÂ±a${creating ? "" : " nueva"}<input name="password" type="password" minlength="12" autocomplete="new-password" ${creating ? "required" : ""} placeholder="${creating ? "MÃƒÂ­nimo 12 caracteres" : "DÃƒÂ©jala vacÃƒÂ­a para conservarla"}" /></label>
    ${creating ? `<div class="full-field user-reactivation-row"><button type="button" class="text-button" data-action="go-reactivate-user" data-user-id="${escapeHTML(usernameStatus.userId || "")}" ${usernameStatus.userId ? "" : "hidden"}>Ir a reactivar esta cuenta Ã¢â€ â€™</button></div>` : ""}
    ${creating ? "" : '<p class="field-help">La contraseÃƒÂ±a se actualiza solo si escribes una nueva (mÃƒÂ­nimo 12 caracteres).</p>'}`;
}

function getUsernameStatus(username, currentUserId = "") {
  const normalized = username.trim().toLowerCase();
  if (!normalized) {
    return {
      conflict: false,
      userId: "",
      message: "Se sugiere desde el nombre. El usuario debe ser ÃƒÂºnico; el rol puede repetirse.",
    };
  }
  const existing = state.users.find((user) =>
    user.id !== currentUserId && user.correo.toLowerCase() === `${normalized}@farmacia.com`);
  if (!existing) {
    return {
      conflict: false,
      userId: "",
      message: "Usuario disponible. El rol puede repetirse en otras cuentas.",
    };
  }
  return {
    conflict: true,
    userId: existing.activo ? "" : existing.id,
    message: existing.activo
      ? `El usuario "${normalized}" ya pertenece a ${existing.nombre}. El rol puede repetirse; cambia este usuario, por ejemplo, a juliana.valencia.`
      : `El usuario "${normalized}" pertenece a la cuenta inactiva de ${existing.nombre}. ReactÃƒÂ­vala desde AdministraciÃƒÂ³n de usuarios o elige otro usuario para crear una cuenta nueva.`,
  };
}

function suggestedUsername(name) {
  return name.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._+-]+/g, ".")
    .replace(/^[.+-]+|[.+-]+$/g, "")
    .slice(0, 64);
}

function updateUsernameFeedback(username) {
  const preview = app.querySelector("[data-email-preview]");
  if (preview) preview.textContent = `${username || "usuario"}@farmacia.com`;
  const status = getUsernameStatus(username, state.modal?.data?.id);
  const availability = app.querySelector("[data-user-availability]");
  if (availability) {
    availability.textContent = status.message;
    availability.classList.toggle("user-availability-error", status.conflict);
  }
  const reactivationLink = app.querySelector('[data-action="go-reactivate-user"]');
  if (reactivationLink) {
    reactivationLink.hidden = !status.userId;
    reactivationLink.dataset.userId = status.userId || "";
  }
}

function activeMedicationOptions(selected = "") {
  return state.medications.filter((item) => item.activo)
    .map((item) => `<option value="${escapeHTML(item.id)}" ${selected === item.id ? "selected" : ""}>${escapeHTML(item.nombre)} Ã‚Â· ${escapeHTML(item.codigo)}</option>`)
    .join("");
}

function saleItemsKey() {
  return state.saleItems
    .map((item) => `${item.medicamentoId}:${item.cantidad}`)
    .sort()
    .join("|");
}

async function refreshSalePreview() {
  const requestId = ++state.salePreviewRequest;
  state.salePreview = null;
  state.salePreviewKey = "";
  state.salePreviewError = "";
  const ids = state.saleItems.map((item) => item.medicamentoId);
  if (state.modal?.type !== "sale-form" || ids.some((id) => !id)) {
    state.salePreviewLoading = false;
    renderShell();
    return;
  }
  if (new Set(ids).size !== ids.length) {
    state.salePreviewError = "Selecciona un medicamento diferente en cada producto.";
    state.salePreviewLoading = false;
    renderShell();
    return;
  }
  const items = state.saleItems.map((item) => ({
    medicamentoId: item.medicamentoId,
    cantidad: Number(item.cantidad),
  }));
  if (items.some((item) => !Number.isSafeInteger(item.cantidad) || item.cantidad < 1)) {
    state.salePreviewError = "Ingresa una cantidad entera mayor que cero.";
    state.salePreviewLoading = false;
    renderShell();
    return;
  }
  const key = saleItemsKey();
  state.salePreviewLoading = true;
  renderShell();
  try {
    const result = await soapCall("PreviewSale", { items: { item: items } });
    if (requestId !== state.salePreviewRequest) return;
    state.salePreview = parseSalePreview(result);
    state.salePreviewKey = key;
  } catch (error) {
    if (requestId === state.salePreviewRequest) state.salePreviewError = error.message;
  } finally {
    if (requestId === state.salePreviewRequest) {
      state.salePreviewLoading = false;
      renderShell();
    }
  }
}

function renderSalePreview() {
  if (state.salePreviewLoading) {
    return `<div class="sale-preview-message" role="status"><span class="spinner spinner-dark"></span>Calculando precio y existenciasÃ¢â‚¬Â¦</div>`;
  }
  if (state.salePreviewError) {
    return `<div class="sale-preview-error" role="alert">${icon("close")}<span>${escapeHTML(state.salePreviewError)}</span></div>`;
  }
  if (!state.salePreview) {
    return `<div class="sale-preview-empty">Selecciona los productos y cantidades para ver el precio estimado.</div>`;
  }
  const groups = state.saleItems.map((item) => {
    const allocations = state.salePreview.allocations
      .filter((allocation) => allocation.medicamentoId === item.medicamentoId);
    const subtotal = allocations.reduce((sum, allocation) => sum + Number(allocation.subtotal), 0);
    const medication = state.medications.find((candidate) => candidate.id === item.medicamentoId);
    return `<div class="sale-preview-group">
      <div class="sale-preview-product"><strong>${escapeHTML(medication?.nombre || "Medicamento")}</strong><span>${item.cantidad} uds. Ã‚Â· ${formatMoney(subtotal)}</span></div>
      ${allocations.map((allocation) => `<div class="sale-preview-allocation"><span>${allocation.cantidad} Ãƒâ€” ${formatMoney(allocation.precioUnitario)}<small>Lote ${escapeHTML(allocation.codigoLote)} Ã‚Â· vence ${formatDate(allocation.fechaVencimiento)} Ã‚Â· stock ${allocation.existenciasDisponibles}</small></span><strong>${formatMoney(allocation.subtotal)}</strong></div>`).join("")}
    </div>`;
  }).join("");
  return `<section class="sale-preview" aria-live="polite"><div class="sale-preview-heading"><h4>Detalle FEFO</h4><span>Precios vigentes</span></div>${groups}<div class="sale-preview-total"><span>Total estimado</span><strong>${formatMoney(state.salePreview.total)}</strong></div></section>`;
}

function matchingSaleMedications(query) {
  const search = normalizeSearchText(query).trim();
  if (!search) return [];
  return state.medications.filter((item) => item.activo
    && normalizeSearchText(`${item.nombre} ${item.codigo} ${item.principioActivo}`).includes(search))
    .slice(0, 8);
}

function selectSaleMedication(index, medicationId) {
  const item = state.saleItems[index];
  const medication = state.medications.find((candidate) => candidate.id === medicationId && candidate.activo);
  if (!item || !medication) return;
  item.medicamentoId = medication.id;
  item.busqueda = medication.nombre;
  item.opcionesAbiertas = false;
  state.salePreview = null;
  state.salePreviewKey = "";
  renderShell();
  void refreshSalePreview();
}

function batchFields(batch = {}) {
  const meds = activeMedicationOptions(batch.medicamentoId);
  const currentMedication = state.medications.find((item) => item.id === batch.medicamentoId);
  const inactiveCurrentMedication = batch.id && currentMedication && !currentMedication.activo
    ? `<option value="${escapeHTML(currentMedication.id)}" selected>${escapeHTML(currentMedication.nombre)} Ã‚Â· ${escapeHTML(currentMedication.codigo)} (inactivo)</option>`
    : "";
  const hasMedicationOptions = Boolean(meds || inactiveCurrentMedication);
  const medicationEmptyState = !meds && !inactiveCurrentMedication && !batch.id
    ? `<div class="form-hint full-field">No hay medicamentos activos. Crea uno y volverÃƒÂ¡s aquÃƒÂ­ para completar el lote. <button type="button" class="button button-soft" data-action="new-medication-from-batch">Crear medicamento</button></div>`
    : "";
  return `
    <label>Medicamento<select name="medicamentoId" required ${hasMedicationOptions ? "" : "disabled"}><option value="" disabled ${batch.medicamentoId ? "" : "selected"}>Selecciona un medicamento</option>${meds}${inactiveCurrentMedication}</select></label>
    ${medicationEmptyState}
    <label>CÃƒÂ³digo de lote<input name="codigoLote" maxlength="80" value="${escapeHTML(batch.codigoLote || "")}" required /></label>
    <label>Fecha de vencimiento<input name="fechaVencimiento" type="date" value="${escapeHTML(batch.fechaVencimiento || "")}" required /></label>
    <label>Existencias<input name="stock" type="number" min="0" step="1" value="${escapeHTML(batch.stock ?? 0)}" required /></label>
    <label>Costo unitario<input name="costoUnitario" type="number" min="0" step="0.01" value="${escapeHTML(batch.costoUnitario || "")}" required /></label>
    <label>Precio de venta<input name="precioVenta" type="number" min="0" step="0.01" value="${escapeHTML(batch.precioVenta || "")}" required /></label>
    ${batch.id ? '<label class="full-field">Motivo del ajuste de existencias<input name="motivo" maxlength="300" placeholder="Obligatorio al guardar este lote" required /></label>' : ""}`;
}

function saleItemRows() {
  return state.saleItems.map((item, index) => {
    const selected = state.medications.find((medication) => medication.id === item.medicamentoId);
    const results = matchingSaleMedications(item.busqueda || "");
    const showResults = item.opcionesAbiertas && Boolean(item.busqueda.trim());
    return `
      <article class="sale-item-card">
        <header class="sale-item-card-header">
          <span class="sale-item-number">Producto ${String(index + 1).padStart(2, "0")}</span>
          ${state.saleItems.length > 1 ? `<button type="button" class="icon-button danger-icon sale-remove-item" data-action="remove-sale-item" data-index="${index}" aria-label="Quitar producto ${index + 1}">${icon("trash")}<span>Quitar</span></button>` : ""}
        </header>
        <div class="sale-item-row">
          <div class="sale-medicine-picker">
            <label for="sale-medicine-search-${index}">Medicamento</label>
            <input id="sale-medicine-search-${index}" type="search" data-sale-search-index="${index}" role="combobox" aria-autocomplete="list" aria-expanded="${showResults}" aria-controls="sale-medicine-options-${index}" value="${escapeHTML(item.busqueda)}" placeholder="Buscar por nombre, cÃƒÂ³digo o principio activo" autocomplete="off" />
            ${selected ? `<span class="sale-selection">Seleccionado: ${escapeHTML(selected.nombre)} Ã‚Â· ${escapeHTML(selected.codigo)}</span>` : '<span class="sale-selection">Busca y selecciona un medicamento del catÃƒÂ¡logo.</span>'}
            ${showResults ? `<div class="sale-medicine-options" id="sale-medicine-options-${index}" role="listbox">${results.length ? results.map((medication) => `<button type="button" class="sale-medicine-option" role="option" data-action="select-sale-medication" data-index="${index}" data-medication-id="${escapeHTML(medication.id)}"><strong>${escapeHTML(medication.nombre)}</strong><small>${escapeHTML(medication.codigo)} Ã‚Â· ${escapeHTML(medication.principioActivo)}</small></button>`).join("") : '<p class="sale-no-results">No hay coincidencias. Prueba otro nombre o cÃƒÂ³digo.</p>'}</div>` : ""}
          </div>
          <label class="sale-quantity">Cantidad<input data-sale-index="${index}" data-sale-field="cantidad" type="number" min="1" step="1" value="${escapeHTML(item.cantidad)}" required /></label>
        </div>
      </article>`;
  }).join("");
}

function renderModal() {
  if (!state.modal) return "";
  const { type, data = {} } = state.modal;
  if (type === "medication-form") {
    const editing = Boolean(data.id);
    const returnToBatch = Boolean(state.modal.returnToBatch);
    const actions = editing
      ? `<button type="button" class="button button-soft" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">Guardar cambios</button>`
      : returnToBatch
        ? `<button type="button" class="button button-soft" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">Guardar y volver al lote</button>`
        : `<button type="button" class="button button-soft" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit" data-next-step="batch">Guardar y registrar lote</button>`;
    return modalShell(editing ? "Editar medicamento" : "Nuevo medicamento",
      `<form data-form="medication" class="modal-form"><div class="form-grid">${medicationFields(data)}</div>${!editing && !returnToBatch ? '<button type="submit" class="text-button">Guardar solo el medicamento</button>' : ""}${formError()}<footer class="modal-actions">${actions}</footer></form>`,
      editing ? "Completa la informaciÃƒÂ³n del catÃƒÂ¡logo." : "Registra el medicamento y, si ya tienes existencias, continÃƒÂºa con su primer lote.");
  }
  if (type === "medication-view") {
    return modalShell("Detalle del medicamento",
      `<dl class="detail-grid"><dt>CÃƒÂ³digo</dt><dd>${escapeHTML(data.codigo)}</dd><dt>Nombre</dt><dd>${escapeHTML(data.nombre)}</dd><dt>Principio activo</dt><dd>${escapeHTML(data.principioActivo)}</dd><dt>PresentaciÃƒÂ³n</dt><dd>${escapeHTML(data.presentacion)}</dd><dt>Precio de referencia</dt><dd>${formatMoney(data.precioReferencia)}</dd><dt>FÃƒÂ³rmula mÃƒÂ©dica</dt><dd>${data.requiereFormula ? "SÃƒÂ­" : "No"}</dd><dt>Estado</dt><dd>${data.activo ? "Activo" : "Inactivo"}</dd></dl><footer class="modal-actions"><button class="button button-soft" data-action="close-modal">Cerrar</button></footer>`);
  }
  if (type === "user-form") {
    const editing = Boolean(data.id);
    return modalShell(editing ? "Editar usuario" : "Crear usuario",
      `<form data-form="user" class="modal-form"><div class="form-grid">${userFields(data, !editing, state.modal.draft)}</div>${formError()}<footer class="modal-actions"><button type="button" class="button button-soft" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit">${editing ? "Guardar cambios" : "Crear usuario"}</button></footer></form>`,
      "El acceso y los permisos dependen del rol asignado.");
  }
  if (type === "user-view") {
    return modalShell("Detalle del usuario",
      `<dl class="detail-grid"><dt>Nombre</dt><dd>${escapeHTML(data.nombre)}</dd><dt>Correo</dt><dd>${escapeHTML(data.correo)}</dd><dt>Rol</dt><dd>${escapeHTML(data.rol)}</dd><dt>Estado</dt><dd>${data.activo ? "Activo" : "Inactivo"}</dd></dl><footer class="modal-actions"><button class="button button-soft" data-action="close-modal">Cerrar</button></footer>`);
  }
  if (type === "batch-form") {
    const editing = Boolean(data.id);
    const canRegister = state.medications.some((item) => item.activo) || Boolean(data.id);
    return modalShell(editing ? "Editar lote" : "Registrar lote",
      `<form data-form="batch" class="modal-form"><div class="form-grid">${batchFields(data)}</div>${formError()}<footer class="modal-actions"><button type="button" class="button button-soft" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit" ${canRegister ? "" : "disabled"}>${editing ? "Guardar cambios" : "Registrar lote"}</button></footer></form>`,
      editing ? "Los cambios de existencias generan movimientos de inventario." : "Elige el medicamento y completa los datos del lote; el stock inicial se registrarÃƒÂ¡ automÃƒÂ¡ticamente.");
  }
  if (type === "batch-view") {
    return modalShell("Detalle del lote",
      `<dl class="detail-grid"><dt>Medicamento</dt><dd>${escapeHTML(data.medicamentoNombre)}</dd><dt>CÃƒÂ³digo de lote</dt><dd>${escapeHTML(data.codigoLote)}</dd><dt>Vencimiento</dt><dd>${formatDate(data.fechaVencimiento)}</dd><dt>Existencias</dt><dd>${data.stock}</dd><dt>Costo</dt><dd>${formatMoney(data.costoUnitario)}</dd><dt>Precio de venta</dt><dd>${formatMoney(data.precioVenta)}</dd></dl><footer class="modal-actions"><button class="button button-soft" data-action="close-modal">Cerrar</button></footer>`);
  }
  if (type === "sale-form") {
    const available = state.medications.some((item) => item.activo);
    const selectedUnits = state.saleItems.reduce((sum, item) => sum + (Number(item.cantidad) > 0 ? Number(item.cantidad) : 0), 0);
    const selectedProducts = state.saleItems.filter((item) => item.medicamentoId).length;
    const previewReady = state.salePreview
      && !state.salePreviewLoading
      && !state.salePreviewError
      && state.salePreviewKey === saleItemsKey();
    return modalShell("Registrar venta",
      `<form data-form="sale" class="modal-form sale-form">
        <div class="sale-guidance"><span class="sale-guidance-icon">${icon("check")}</span><div><strong>Inventario protegido</strong><p>Se asignarÃƒÂ¡n lotes vigentes con existencias, priorizando los prÃƒÂ³ximos a vencer.</p></div></div>
        <div class="sale-workspace">
          <section class="sale-products">
            <div class="sale-section-heading"><div><h3>Productos de la venta</h3><p>Agrega uno o mÃƒÂ¡s medicamentos y define la cantidad.</p></div><span class="sale-item-count">${state.saleItems.length} ${state.saleItems.length === 1 ? "lÃƒÂ­nea" : "lÃƒÂ­neas"}</span></div>
            <div class="sale-items">${saleItemRows()}</div>
            <button type="button" class="button button-soft add-item-button" data-action="add-sale-item">${icon("plus")}Agregar producto</button>
          </section>
          <aside class="sale-cart" aria-label="Resumen del carrito">
            <header class="sale-cart-header"><div><span>Carrito</span><strong>${selectedProducts} ${selectedProducts === 1 ? "producto" : "productos"}</strong></div><span class="sale-cart-count">${selectedUnits} uds.</span></header>
            ${renderSalePreview()}
            <p class="sale-total-note">La cotizaciÃƒÂ³n es informativa; el backend validarÃƒÂ¡ el precio y las existencias al confirmar.</p>
          </aside>
        </div>
        ${formError()}
        <footer class="modal-actions"><button type="button" class="button button-soft" data-action="close-modal">Cancelar</button><button class="button button-primary" type="submit" ${available && previewReady ? "" : "disabled"}>${icon("check")}Confirmar venta</button></footer>
      </form>`,
      available ? "El inventario se actualiza al confirmar." : "Registra medicamentos y lotes vigentes con stock para vender.",
      "sale-modal");
  }
  if (type === "sale-view") {
    const items = data.items || [];
    const reverseAction = state.user.rol === "administrador" && data.estado === "confirmada"
      ? `<div class="sale-reversal-actions"><button type="button" class="button button-danger" data-action="reverse-sale" data-id="${escapeHTML(data.id)}">${icon("undo")}Revertir venta</button></div>`
      : "";
    const detailRows = items.map((item) => {
      const medication = state.medications.find((candidate) => candidate.id === item.medicamentoId);
      const batch = state.batches.find((candidate) =>
        candidate.id === item.loteId
        || (candidate.codigoLote === item.codigoLote && candidate.medicamentoId === item.medicamentoId));
      const medicationName = item.medicamentoNombre
        || medication?.nombre
        || batch?.medicamentoNombre
        || "Medicamento no disponible";
      return `<div class="receipt-product-row"><div><strong class="table-primary">${escapeHTML(medicationName)}</strong></div><div>${escapeHTML(item.codigoLote || "Ã¢â‚¬â€")}</div><div>${item.cantidad}</div><div>${formatMoney(item.precioUnitario)}</div><div class="align-right">${formatMoney(item.subtotal)}</div></div>`;
    }).join("");
    const receiptDetails = items.length
      ? `<div class="receipt-products"><div class="receipt-product-header"><span>MEDICAMENTO</span><span>LOTE</span><span>CANT.</span><span>PRECIO UNITARIO</span><span class="align-right">SUBTOTAL</span></div>${detailRows}</div>`
      : emptyState("Sin detalle", "Esta venta no tiene productos disponibles.");
    return modalShell(`Venta ${data.numero}`,
      `<div class="receipt-summary"><span class="status ${data.estado === "confirmada" ? "status-good" : "status-neutral"}">${escapeHTML(data.estado)}</span><dl class="detail-grid"><dt>Fecha y hora</dt><dd>${formatDateTime(data.fecha)}</dd><dt>AtendiÃƒÂ³</dt><dd>${escapeHTML(data.usuarioNombre || `Usuario #${data.usuarioId}`)}</dd><dt>Productos</dt><dd>${data.cantidadProductos || items.length}</dd></dl></div><h3 class="modal-section-title">Detalle de productos</h3>${receiptDetails}<div class="receipt-total"><span>Total</span><strong>${formatMoney(data.total)}</strong></div>${reverseAction}<footer class="modal-actions receipt-actions"><button type="button" class="button button-soft" data-action="close-modal">Cerrar</button><button type="button" class="button button-primary" data-action="print-sale">${icon("print")}Imprimir comprobante</button></footer>`,
      "Comprobante de venta",
      "sale-receipt-modal");
  }
  return "";
}

function notify(message) {
  state.toast = message;
  renderShell();
  window.setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      renderShell();
    }
  }, 4500);
}

function successAlert(message) {
  window.Swal.fire({
    icon: "success",
    iconColor: "#087b57",
    title: "Ã‚Â¡Cambios guardados!",
    text: message,
    timer: 3000,
    timerProgressBar: true,
    showConfirmButton: false,
    heightAuto: false,
    customClass: { popup: "pharmacy-swal" },
  });
}

async function finishMutation(message) {
  state.modal = null;
  state.modalError = "";
  renderShell();
  successAlert(message);
  try {
    await loadData();
    renderShell();
  } catch (error) {
    notify(`Cambios guardados, pero no se pudo actualizar la vista: ${error.message}`);
  }
}

function closeModal() {
  state.modal = null;
  state.modalError = "";
  renderShell();
}

async function openAction(action, id) {
  state.modalError = "";
  if (action === "new-medication") state.modal = { type: "medication-form" };
  if (action === "edit-medication" || action === "view-medication") {
    const result = await soapCall("GetMedication", { id });
    const data = parseMedication(child(result, "medication"));
    state.modal = { type: action === "edit-medication" ? "medication-form" : "medication-view", data };
  }
  if (action === "new-user") state.modal = { type: "user-form", usernameEdited: false };
  if (action === "edit-user" || action === "view-user") {
    const result = await soapCall("GetUser", { id });
    const data = parseUser(child(result, "user"));
    state.modal = { type: action === "edit-user" ? "user-form" : "user-view", data };
  }
  if (action === "new-batch") state.modal = { type: "batch-form" };
  if (action === "edit-batch" || action === "view-batch") {
    const result = await soapCall("GetBatch", { id });
    const data = parseBatch(child(result, "batch"));
    state.modal = { type: action === "edit-batch" ? "batch-form" : "batch-view", data };
  }
  if (action === "new-sale") {
    state.saleItems = [{ medicamentoId: "", cantidad: 1, busqueda: "", opcionesAbiertas: false }];
    state.salePreview = null;
    state.salePreviewError = "";
    state.salePreviewLoading = false;
    state.salePreviewKey = "";
    state.salePreviewRequest += 1;
    state.modal = { type: "sale-form" };
  }
  if (action === "view-sale") {
    const result = await soapCall("GetSale", { id });
    state.modal = { type: "sale-view", data: parseSale(child(result, "sale")) };
  }
  renderShell();
}

async function submitForm(form, submitter) {
  const values = new FormData(form);
  const data = Object.fromEntries(values.entries());
  const submitButton = submitter || form.querySelector('[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.dataset.originalLabel = submitButton.innerHTML;
    submitButton.innerHTML = '<span class="spinner spinner-dark"></span> GuardandoÃ¢â‚¬Â¦';
  }
  try {
    if (form.dataset.form === "medication") {
      const editing = Boolean(state.modal.data?.id);
      const request = {
        codigo: data.codigo,
        nombre: data.nombre,
        principioActivo: data.principioActivo,
        presentacion: data.presentacion,
        requiereFormula: form.elements.requiereFormula.checked,
        precioReferencia: data.precioReferencia,
      };
      if (editing) {
        await soapCall("UpdateMedication", { id: state.modal.data.id, ...request });
      } else {
        const result = await soapCall("CreateMedication", request);
        const nextStepIsBatch = state.modal.returnToBatch || submitter?.dataset.nextStep === "batch";
        if (nextStepIsBatch) {
          const medicationElement = child(result, "medication");
          if (!medicationElement) {
            throw new Error("El medicamento se guardÃƒÂ³, pero el servicio no devolviÃƒÂ³ sus datos para continuar con el lote.");
          }
          const medication = parseMedication(medicationElement);
          if (!medication.id || !medication.activo) {
            throw new Error("El medicamento se guardÃƒÂ³, pero no se pudo preparar el lote. Revisa el catÃƒÂ¡logo e intÃƒÂ©ntalo de nuevo.");
          }
          const batchDraft = state.modal.batchDraft || {};
          state.medications = [...state.medications.filter((item) => item.id !== medication.id), medication];
          state.modal = {
            type: "batch-form",
            data: { ...batchDraft, medicamentoId: medication.id },
          };
          state.modalError = "";
          renderShell();
          successAlert("Medicamento guardado. Completa los datos de su lote.");
          return;
        }
      }
      await finishMutation(editing ? "Medicamento actualizado." : "Medicamento guardado.");
      return;
    }
    if (form.dataset.form === "user") {
      const username = data.usuario.trim().toLowerCase();
      if (!/^[a-z0-9._+-]{1,64}$/.test(username)) {
        throw new Error("Escribe solo el usuario, sin dominio ni espacios.");
      }
      const request = {
        nombre: data.nombre,
        correo: `${username}@farmacia.com`,
        ...(data.password ? { password: data.password } : {}),
        rol: data.rol,
      };
      const existingUser = state.users.find((user) =>
        user.id !== state.modal.data?.id && user.correo.toLowerCase() === request.correo);
      if (existingUser) {
        updateUsernameFeedback(username);
        return;
      }
      if (state.modal.data?.id) {
        await soapCall("UpdateUser", { id: state.modal.data.id, ...request });
      } else {
        await soapCall("CreateUser", request);
      }
      await finishMutation("Usuario guardado correctamente.");
      return;
    }
    if (form.dataset.form === "batch") {
      if (state.modal.data?.id) {
        await soapCall("UpdateBatch", { id: state.modal.data.id, ...data });
      } else {
        await soapCall("CreateBatch", data);
      }
      await finishMutation("Lote guardado correctamente.");
      return;
    }
    if (form.dataset.form === "sale") {
      const ids = state.saleItems.map((item) => item.medicamentoId);
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
        throw new Error("Selecciona un medicamento diferente en cada lÃƒÂ­nea.");
      }
      const items = state.saleItems.map((item) => ({
        medicamentoId: item.medicamentoId,
        cantidad: Number(item.cantidad),
      }));
      if (!state.salePreview || state.salePreviewKey !== saleItemsKey() || state.salePreviewLoading) {
        throw new Error(state.salePreviewError || "Espera a que se calcule una cotizaciÃƒÂ³n vÃƒÂ¡lida antes de confirmar.");
      }
      form.querySelector('[type="submit"]').disabled = true;
      const result = await soapCall("CreateSale", { items: { item: items } });
      const sale = parseSale(child(result, "sale"));
      await finishMutation("Venta registrada y stock actualizado.");
      state.modal = { type: "sale-view", data: sale };
      renderShell();
    }
  } catch (error) {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = submitButton.dataset.originalLabel || "Guardar";
    }
    const usernameStatus = app.querySelector("[data-user-availability]")?.textContent;
    state.modalError = error.message === usernameStatus ? "" : error.message;
    if (form.dataset.form === "user" && state.modal?.type === "user-form") {
      state.modal.draft = {
        nombre: data.nombre,
        usuario: data.usuario,
        rol: data.rol,
      };
      state.modal.usernameEdited = true;
    }
    renderShell();
  }
}

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-user-full-name]")) {
    if (state.modal?.type === "user-form" && !state.modal.data?.id && !state.modal.usernameEdited) {
      const username = suggestedUsername(event.target.value);
      const usernameInput = app.querySelector("#user-username");
      if (usernameInput) usernameInput.value = username;
      updateUsernameFeedback(username);
    }
    return;
  }
  if (event.target.name === "usuario") {
    if (state.modal?.type === "user-form" && !state.modal.data?.id) state.modal.usernameEdited = true;
    const username = event.target.value.split("@", 1)[0].replace(/[^a-zA-Z0-9._+-]/g, "").toLowerCase();
    event.target.value = username;
    updateUsernameFeedback(username);
    return;
  }
  if (event.target.dataset.saleSearchIndex !== undefined) {
    const index = Number(event.target.dataset.saleSearchIndex);
    const item = state.saleItems[index];
    if (!Number.isInteger(index) || !item) return;
    const value = event.target.value;
    const selection = event.target.selectionStart;
    item.medicamentoId = "";
    item.busqueda = value;
    item.opcionesAbiertas = true;
    state.salePreview = null;
    state.salePreviewKey = "";
    state.salePreviewError = "";
    state.salePreviewLoading = false;
    state.salePreviewRequest += 1;
    renderShell();
    const search = app.querySelector(`[data-sale-search-index="${index}"]`);
    search?.focus();
    if (typeof selection === "number") search?.setSelectionRange(selection, selection);
    return;
  }
  if (event.target.id === "medicine-search") {
    state.search = event.target.value;
  } else if (event.target.id === "batch-search") {
    state.batchSearch = event.target.value;
  } else {
    return;
  }
  const searchId = event.target.id;
  const selection = event.target.selectionStart;
  window.clearTimeout(state.searchTimers[searchId]);
  state.searchTimers[searchId] = window.setTimeout(() => {
    state.pagination[searchId === "medicine-search" ? "medications" : "batches"] = { page: 1 };
    renderShell();
    const search = app.querySelector(`#${searchId}`);
    search?.focus();
    if (typeof selection === "number") search?.setSelectionRange(selection, selection);
  }, 250);
});

app.addEventListener("keydown", (event) => {
  if (state.modal && event.key === "Tab") {
    const modal = app.querySelector(".modal");
    const focusable = Array.from(modal?.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") || [])
      .filter((element) => element.offsetParent !== null);
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  const search = event.target.closest("[data-sale-search-index]");
  if (!search) {
    if (event.key === "Escape" && state.modal) closeModal();
    return;
  }
  const index = Number(search.dataset.saleSearchIndex);
  const item = state.saleItems[index];
  if (!item) return;
  if (event.key === "ArrowDown" && item.opcionesAbiertas) {
    const firstOption = app.querySelector(`#sale-medicine-options-${index} [data-action="select-sale-medication"]`);
    if (firstOption) {
      event.preventDefault();
      firstOption.focus();
    }
  } else if (event.key === "Enter" && item.opcionesAbiertas) {
    const firstMatch = matchingSaleMedications(item.busqueda)[0];
    if (firstMatch) {
      event.preventDefault();
      selectSaleMedication(index, firstMatch.id);
    }
  } else if (event.key === "Escape" && item.opcionesAbiertas) {
    item.opcionesAbiertas = false;
    renderShell();
  }
});

app.addEventListener("change", (event) => {
  const index = Number(event.target.dataset.saleIndex);
  const fieldName = event.target.dataset.saleField;
  if (!Number.isInteger(index) || !fieldName || !state.saleItems[index]) return;
  state.saleItems[index][fieldName] = event.target.value;
  void refreshSalePreview();
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  if (form.dataset.form) {
    event.preventDefault();
    await submitForm(form, event.submitter);
    return;
  }
  if (form.id === "movement-filter") {
    event.preventDefault();
    state.movementFilters = Object.fromEntries(new FormData(form).entries());
    try {
      await loadMovements(state.movementFilters);
      renderShell();
    } catch (error) {
      notify(error.message);
    }
  }
  if (form.id === "sales-filter") {
    event.preventDefault();
    state.salesFilters = Object.fromEntries(new FormData(form).entries());
    try {
      await loadSalesHistory(state.salesFilters);
      renderShell();
    } catch (error) {
      notify(error.message);
    }
  }
  if (form.id === "user-filter") {
    event.preventDefault();
    state.userFilters = Object.fromEntries(new FormData(form).entries());
    renderShell();
  }
});

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === "table-sort") {
    const scope = target.dataset.scope;
    const key = target.dataset.key;
    const current = state.tableSort[scope];
    state.tableSort[scope] = {
      key,
      direction: current?.key === key && current.direction === "asc" ? "desc" : "asc",
    };
    state.pagination[scope] = { page: 1 };
    renderShell();
    return;
  }
  if (action === "table-page") {
    const page = Number(target.dataset.page);
    if (!Number.isFinite(page) || page < 1) return;
    state.pagination[target.dataset.scope] = { page };
    renderShell();
    return;
  }
  if (action === "new-medication-from-batch") {
    const form = app.querySelector('[data-form="batch"]');
    const batchDraft = form ? Object.fromEntries(new FormData(form).entries()) : {};
    state.modal = { type: "medication-form", returnToBatch: true, batchDraft };
    state.modalError = "";
    renderShell();
    return;
  }
  if (action === "export-medications") {
    exportCsv("medicamentos.csv",
      ["Nombre", "CÃƒÂ³digo", "Principio activo", "PresentaciÃƒÂ³n", "Precio referencia", "FÃƒÂ³rmula", "Estado"],
      state.medications.map((item) => [item.nombre, item.codigo, item.principioActivo, item.presentacion, item.precioReferencia, item.requiereFormula ? "SÃƒÂ­" : "No", item.activo ? "Activo" : "Inactivo"]));
    notify("CatÃƒÂ¡logo exportado a CSV.");
    return;
  }
  if (action === "export-batches") {
    exportCsv("inventario.csv",
      ["Medicamento", "Lote", "Vencimiento", "Stock", "Costo", "Precio"],
      state.batches.map((item) => [item.medicamentoNombre, item.codigoLote, item.fechaVencimiento, item.stock, item.costoUnitario, item.precioVenta]));
    notify("Inventario exportado a CSV.");
    return;
  }
  if (action === "export-sales") {
    exportCsv("ventas.csv",
      ["NÃƒÂºmero", "Fecha", "Usuario", "Productos", "Estado", "Total"],
      state.sales.map((item) => [item.numero, item.fecha, item.usuarioNombre || item.usuarioId, item.cantidadProductos, item.estado, item.total]));
    notify("Ventas exportadas a CSV.");
    return;
  }
  if (action === "sales-period") {
    state.salesFilters = { ...state.salesFilters, ...salesPresetRange(target.dataset.period) };
    try {
      await loadSalesHistory();
      renderShell();
    } catch (error) {
      notify(error.message);
    }
    return;
  }
  if (action === "print-sale") {
    window.print();
    return;
  }
  if (action === "go-reactivate-user") {
    state.modal = null;
    state.modalError = "";
    state.route = "usuarios";
    state.userFilters = { rol: "", activo: "false" };
    renderShell();
    return;
  }
  if (action === "close-modal") {
    if (target.classList.contains("modal-backdrop") && event.target !== target) return;
    closeModal();
    return;
  }
  if (action === "inventory-tab") {
    state.inventoryTab = target.dataset.tab;
    if (state.inventoryTab === "movimientos" && !state.movementsLoaded) {
      try {
        await loadMovements();
      } catch (error) {
        notify(error.message);
        return;
      }
    }
    renderShell();
    return;
  }
  if (action === "add-sale-item") {
    state.saleItems.push({ medicamentoId: "", cantidad: 1, busqueda: "", opcionesAbiertas: false });
    state.salePreview = null;
    state.salePreviewError = "";
    state.salePreviewLoading = false;
    state.salePreviewKey = "";
    state.salePreviewRequest += 1;
    renderShell();
    return;
  }
  if (action === "select-sale-medication") {
    selectSaleMedication(Number(target.dataset.index), target.dataset.medicationId);
    return;
  }
  if (action === "remove-sale-item") {
    state.saleItems.splice(Number(target.dataset.index), 1);
    state.salePreview = null;
    state.salePreviewError = "";
    state.salePreviewLoading = false;
    state.salePreviewKey = "";
    state.salePreviewRequest += 1;
    renderShell();
    void refreshSalePreview();
    return;
  }
  if (action === "deactivate-medication") {
    if (!window.confirm("Ã‚Â¿Desactivar este medicamento? Se conservarÃƒÂ¡ su historial.")) return;
    try {
      await soapCall("DeactivateMedication", { id });
      await finishMutation("Medicamento desactivado.");
    } catch (error) {
      notify(error.message);
    }
    return;
  }
  if (action === "activate-medication") {
    if (!window.confirm("Ã‚Â¿Reactivar este medicamento? VolverÃƒÂ¡ a estar disponible para las operaciones.")) return;
    try {
      await soapCall("ActivateMedication", { id });
      await finishMutation("Medicamento reactivado correctamente.");
    } catch (error) {
      notify(error.message);
    }
    return;
  }
  if (action === "deactivate-user") {
    if (!window.confirm("Ã‚Â¿Desactivar este usuario? Ya no podrÃƒÂ¡ iniciar sesiÃƒÂ³n.")) return;
    try {
      await soapCall("DeactivateUser", { id });
      await finishMutation("Usuario desactivado.");
    } catch (error) {
      notify(error.message);
    }
    return;
  }
  if (action === "activate-user") {
    if (!window.confirm("Ã‚Â¿Reactivar este usuario? PodrÃƒÂ¡ volver a iniciar sesiÃƒÂ³n.")) return;
    try {
      await soapCall("ActivateUser", { id });
      state.userFilters.activo = "";
      await finishMutation("Usuario reactivado correctamente.");
    } catch (error) {
      notify(error.message);
    }
    return;
  }
  if (action === "delete-batch") {
    if (!window.confirm("Ã‚Â¿Eliminar este lote? No se podrÃƒÂ¡ eliminar si tiene movimientos o ventas asociados.")) return;
    try {
      await soapCall("DeleteBatch", { id });
      await finishMutation("Lote eliminado.");
    } catch (error) {
      notify(error.message);
    }
    return;
  }
  if (action === "reverse-sale") {
    if (!window.confirm("Ã‚Â¿Revertir esta venta? Se repondrÃƒÂ¡n las existencias.")) return;
    try {
      await soapCall("ReverseSale", { id });
      await finishMutation("Venta revertida y existencias repuestas.");
    } catch (error) {
      notify(error.message);
    }
    return;
  }
  if (action === "refresh") {
    target.disabled = true;
    target.innerHTML = '<span class="spinner spinner-dark"></span> ActualizandoÃ¢â‚¬Â¦';
    try {
      await loadData();
      state.toast = "InformaciÃƒÂ³n actualizada.";
      renderShell();
    } catch (error) {
      target.disabled = false;
      notify(error.message);
    }
    return;
  }
  try {
    await openAction(action, id);
  } catch (error) {
    notify(error.message);
  }
});

const savedToken = sessionStorage.getItem("verdesalud.session");
if (savedToken) {
  state.token = savedToken;
  soapCall("ValidateSession")
    .then((result) => {
      state.user = parseUser(child(result, "user"));
      const expiresInSeconds = Number(field(result, "expiresInSeconds")) || 2 * 60 * 60;
      state.sessionExpiry = Date.now() + expiresInSeconds * 1000;
      return loadData();
    })
    .then(renderShell)
    .catch((error) => {
      sessionStorage.removeItem("verdesalud.session");
      state.token = "";
      renderLogin(error.message);
    });
} else {
  renderLogin();
}

window.setInterval(() => {
  if (!state.token || !state.sessionExpiry) return;
  const remaining = state.sessionExpiry - Date.now();
  if (remaining <= 0) {
    state.token = "";
    state.user = null;
    state.sessionExpiry = 0;
    sessionStorage.removeItem("verdesalud.session");
    renderLogin("Tu sesiÃƒÂ³n expirÃƒÂ³. Inicia sesiÃƒÂ³n nuevamente.");
  } else if (remaining <= SESSION_WARNING_MS && !state.sessionWarningShown) {
    state.sessionWarningShown = true;
    notify("Tu sesiÃƒÂ³n vencerÃƒÂ¡ pronto. Guarda tus cambios antes de continuar.");
  }
}, 30_000);
