# PFJ Coordinación

App web para coordinar PFJ desde el celular o la computadora, conectada a **Supabase**.
Se puede instalar: en Chrome, Edge o Android aparece «Instalar app» o «Agregar a pantalla de inicio»;
en iPhone (Safari) se usa Compartir → «Agregar a inicio». Para instalarla hace falta publicarla con HTTPS.

**Puesta en marcha:** seguí `supabase/GUIA.md`.

## Qué hace

- **Ingreso con correo y código** (Supabase Auth). La única dueña es **daianaac11@gmail.com**.
- **Solicitar acceso:** quien confirma su correo pero no tiene permiso deja su nombre, función y un mensaje.
- **Accesos** (solo la dueña): aceptar o rechazar con un **rol** (coordinador/a, auxiliar, bienestar,
  consejero/a + estaca, obispo, enfermería, cocina), cambiar roles, quitar accesos, cargar el Excel,
  exportar y cambiar el nombre de la casilla Sí / No.
- **Cada rol ve solo lo suyo:** lo filtra el servidor (`get_people` en `supabase/schema.sql`), no la pantalla.
- **Inicio, Consejeros, Participantes, Obispos, Salud/Dietas**, según el rol.
- Las marcas Sí / No y «obispo avisado» se guardan en línea y las ve todo el equipo (botón ⟳ para actualizar).

## Probar en esta computadora

```
powershell -ExecutionPolicy Bypass -File app\serve.ps1
```

Abrí http://localhost:5173

## Archivos

- `config.js` — dirección del proyecto Supabase y clave pública.
- `app.js` — la app. `styles.css` — estilos. `sw.js` — instalación y uso sin conexión (no guarda datos personales).
- `../supabase/schema.sql` — tablas, roles y reglas de seguridad.
