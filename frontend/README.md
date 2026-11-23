# FarmaSalud Popayán frontend

Interfaz web independiente para el backend SOAP de farmacia. El frontend vive en esta carpeta y consume las operaciones disponibles de sesiones, usuarios, medicamentos, lotes, alertas, inventario y ventas; las reglas de negocio y autorización siguen en el backend.

## Iniciar

1. Configura e inicia PostgreSQL y el backend siguiendo [backend/README.md](../backend/README.md).
2. En `backend/.env`, configura el origen exacto desde el que abrirás la interfaz:

   ```env
   CORS_ORIGIN=http://localhost:5173
   ```

   Reinicia el backend después de cambiar la configuración. Abre tanto el backend como el frontend con `localhost` (no mezcles `localhost` y `127.0.0.1`).
3. En una terminal, desde la raíz del proyecto, instala la dependencia visual y ejecuta el frontend:

   ```powershell
   npm --prefix frontend install
   npm --prefix frontend run dev
   ```

4. Abre `http://localhost:5173` e inicia sesión con una cuenta creada en el backend. El frontend se conecta internamente con `http://localhost:4000/soap`.

## Módulos

- **Resumen:** indicadores de medicamentos, existencias, vencimientos y ventas recientes.
- **Medicamentos:** consulta y búsqueda por nombre, código o principio activo, detalle, creación y edición; la desactivación está reservada al administrador.
- **Inventario:** consulta y detalle de lotes, registro y edición, ajustes de existencias con motivo, y eliminación de lotes sin historial (administrador).
- **Movimientos:** filtros por lote, venta, tipo y fechas, con nombre y rol del usuario que realizó cada movimiento; disponible para administrador, operador y auditor.
- **Ventas:** historial con búsqueda por venta, usuario o medicamento; filtros por estado y fechas con periodos rápidos; indicadores comparables con el periodo anterior; cotización de productos, cantidades, precios por lote y stock antes de confirmar; comprobante imprimible; y reversión de ventas confirmadas.
- **Usuarios:** consulta, creación con usuario único sugerido desde el nombre y dominio fijo `@farmacia.com`, edición de datos, roles y contraseña, y desactivación/reactivación (administrador). El correo debe ser único; se permiten varios usuarios con el mismo rol.

La interfaz muestra acciones según el rol, pero el backend vuelve a validar cada permiso. Las listas recorren las páginas del servicio, cuyo tamaño máximo es 100. El frontend usa un servidor estático basado en módulos nativos y mantiene sus dependencias separadas de las del backend. La sesión se conserva únicamente en la pestaña actual.

Las operaciones que modifican datos muestran una confirmación SweetAlert2 que se cierra automáticamente después de 3 segundos.
