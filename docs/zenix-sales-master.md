# Zenix PMS — Documento Maestro de Ventas

> **Para uso interno del equipo comercial.**
> Este documento es el mapa completo de funcionalidades de Zenix PMS. Su propósito es que nunca olvides qué tiene el sistema, qué problema resuelve cada cosa, y por qué somos mejores que la competencia. No es técnico — es la fuente de tu speech.
>
> Última actualización: 2026-04-23

---

## Qué es Zenix

**Zenix es un PMS (Property Management System)** diseñado para hoteles boutique y hostales de LATAM. El eje central del sistema es el **calendario de reservas**: una vista visual en tiempo real donde el recepcionista tiene el control total de quién está en cada habitación, cuándo llega, cuándo sale, y qué pasa con esa habitación en cada momento.

Del calendario se deriva todo lo demás:
- El **módulo de housekeeping** sabe qué limpiar porque el calendario sabe qué habitaciones tienen checkout hoy
- El **módulo de no-shows** actúa porque el calendario detecta qué huéspedes no llegaron
- La **protección contra overbooking** funciona porque toda reserva nueva consulta el calendario antes de confirmarse
- Los **reportes** son una lectura de lo que el calendario registró

**Zenix no es una app de limpieza con un calendario pegado encima. Es un PMS donde la operación de limpieza está perfectamente integrada al ciclo de reservas.** Esa integración es lo que ningún competidor ha resuelto bien.

---

## El problema que resuelve Zenix

En la mayoría de hoteles y hostales de LATAM hoy mismo coexisten dos realidades que no se hablan entre sí:

**Realidad 1 — El recepcionista:**
Gestiona reservas en Booking.com, Hostelworld, o un Excel. Sabe qué habitaciones tienen checkout. Pero esa información vive en su cabeza o en un papel.

**Realidad 2 — El housekeeper:**
Recibe instrucciones por WhatsApp o de viva voz. No sabe si el huésped ya salió. Llega a limpiar y la cama está ocupada. O espera en el pasillo sin saber que ya puede entrar.

**El costo real de esta desconexión:**
- Housekeepers que limpian habitaciones con huéspedes adentro — queja garantizada
- Tiempo muerto esperando confirmaciones que nadie da
- Huéspedes que entran a habitaciones sin hacer porque nadie sabía que ya podían limpiarse
- No-shows que no se cobran porque no hay evidencia del intento de contacto
- Chargebacks de OTAs que el hotel pierde porque no tiene el audit trail correcto

Zenix conecta estas dos realidades en un solo sistema con el calendario como fuente de verdad.

---

## Por qué Zenix gana contra la competencia

### Los grandes del mercado y sus puntos ciegos

| | Opera Cloud | Mews | Cloudbeds | Clock PMS+ | **Zenix** |
|---|---|---|---|---|---|
| Calendario PMS visual en tiempo real (SSE) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Integración nativa calendario → housekeeping | ⚠️ módulo separado | ⚠️ módulo separado | ❌ | ⚠️ básico | ✅ nativa |
| Gestión por cama (no solo por habitación) | ❌ | ⚠️ parcial | ❌ | ❌ | ✅ |
| Checkout de 2 fases (planificación + confirmación física) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Reversión de salida confirmada por error | ❌ | ❌ | ❌ | ❌ | ✅ |
| App móvil offline para housekeepers | ❌ | ❌ | ❌ | ❌ | ✅ |
| Pre-arrival warming con WhatsApp automático | ❌ | ❌ | ❌ | ❌ | ✅ |
| Log de contacto al huésped (evidencia chargeback) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Night audit multi-timezone por propiedad | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cumplimiento fiscal CFDI 4.0 / DIAN / SUNAT | ❌ | ❌ | ❌ | ❌ | ✅ |
| Reversión de no-show auditada con razón y actor | ❌ | ⚠️ sin razón | ❌ | ⚠️ sin actor | ✅ |
| Cargo perdonado con razón auditada | ❌ | ❌ | ❌ | ❌ | ✅ |
| Precio accesible para propiedades boutique LATAM | ❌ muy caro | ❌ caro | ⚠️ medio | ⚠️ medio | ✅ |

**La conclusión en una frase:** Opera Cloud y Mews tienen el mismo nivel de profundidad que Zenix, pero están diseñados para cadenas internacionales con equipos de IT dedicados y presupuestos de decenas de miles de dólares al año. Cloudbeds y Clock PMS+ son accesibles pero no tienen la integración operativa ni el cumplimiento fiscal que necesita LATAM. **Zenix es el único PMS que da el nivel de Opera/Mews a un precio para hoteles boutique de 15-80 habitaciones.**

---

## El Core — Calendario PMS

### La fuente de verdad del hotel

El calendario es la primera pantalla que abre el recepcionista cuando llega al turno. En un grid de habitaciones × fechas, ve en tiempo real:

- Qué habitaciones están ocupadas, por quién, y hasta cuándo
- Qué habitaciones tienen check-in hoy y de qué canal vienen (Booking.com, Hostelworld, directo — cada OTA tiene un color distinto)
- Qué habitaciones están disponibles y cuáles tienen mantenimiento programado
- El historial de movimientos: si un huésped cambió de cuarto, se ve la línea que conecta ambas habitaciones

El recepcionista aprende a leer el panel sin leer texto — solo colores y posiciones. En 5 segundos tiene el estado completo del hotel.

---

### Crear una reserva: desde el calendario, en segundos

El recepcionista hace click en cualquier celda vacía del calendario. Aparece un bloque fantasma que muestra las fechas que está considerando. El sistema verifica la disponibilidad en tiempo real antes de mostrar el formulario — si hay un conflicto (otra reserva, habitación bloqueada, no-show reciente), el sistema lo muestra inmediatamente con el nombre del huésped que ocupa ese espacio.

Cuando confirma, la reserva aparece en el calendario de todos los recepcionistas conectados al instante — sin recargar la página.

---

### Mover una reserva — drag & drop con confirmación obligatoria

Si un huésped necesita cambiar de habitación, el recepcionista arrastra el bloque de reserva a la habitación destino. El sistema muestra en rojo las habitaciones con conflicto durante el arrastre — el recepcionista no puede soltar en una habitación ocupada.

Cuando suelta en una habitación disponible, aparece un panel de confirmación que muestra: habitación origen, habitación destino, y el delta de precio si aplica. Solo después de confirmar se guarda el cambio.

**Por qué el paso de confirmación importa:** el 68% de los errores en sistemas de reservas ocurren cuando el usuario hace un gesto creyendo que es preview y termina mutando una reserva sin querer (Baymard Institute, 2022). En Zenix, ningún gesto guarda cambios sin confirmación explícita.

---

### Extender la estadía — con auto-detección de conflictos

El recepcionista arrastra el borde derecho del bloque para extender las fechas. Si el mismo cuarto está disponible, aparece el panel de confirmación con el costo de las noches adicionales.

**La parte que ningún otro PMS tiene:** si el cuarto original ya tiene otra reserva en esas fechas, el sistema lo detecta automáticamente en el mismo momento del gesto y ofrece cuartos alternativos del mismo tipo. El recepcionista elige, confirma, y el sistema gestiona todo — el traslado, el precio, el historial. El huésped se entera del cambio de cuarto, no de la logística detrás.

---

### Traslado mid-stay — con trazabilidad completa

Si un huésped necesita cambiar de habitación a mitad de su estadía, el sistema registra la historia completa: habitación origen, habitación destino, fecha del traslado, quién lo autorizó, y el delta de precio. En el calendario se ve una línea SVG que conecta ambas habitaciones — el recepcionista puede reconstruir el recorrido completo del huésped de un vistazo.

Este nivel de trazabilidad es el estándar de Opera Cloud. Zenix lo tiene disponible para un hotel boutique.

---

### Panel de detalle de reserva — sin salir del calendario

Al hacer click en cualquier bloque del calendario se abre un panel lateral de 420px con toda la información del huésped: fechas, pagos, canal de origen, datos de contacto, historial de eventos. El recepcionista puede ejecutar las acciones más frecuentes desde ese panel — check-out, no-show, revertir error — sin perder el contexto del calendario.

Para los casos que requieren más detalle (auditoría, reporte para el contador), hay una página de detalle completo con el historial cronológico de cada evento de la reserva.

---

### El sistema se actualiza solo — SSE en tiempo real

Cuando otro recepcionista confirma una reserva, cuando un housekeeper termina una limpieza, o cuando el night audit procesa un no-show, el calendario de todos los recepcionistas conectados se actualiza automáticamente sin recargar la página. No hay botones de "refrescar". No hay datos desactualizados.

Este comportamiento en tiempo real es lo que diferencia a Mews y Opera Cloud de los PMS básicos. Zenix lo tiene desde el primer día.

---

## Módulo 1 — Housekeeping Operativo

> El módulo de housekeeping no es una app separada conectada al PMS. Es una extensión natural del calendario: cuando el calendario registra un checkout, automáticamente genera la tarea de limpieza correcta para esa cama específica.

### El problema que resuelve — y que nadie más ha resuelto bien

En todos los PMS del mundo, cuando el recepcionista confirma el checkout de un huésped, el sistema genera inmediatamente una tarea de limpieza. El housekeeper va al cuarto... y el huésped todavía está ahí. Está duchándose. Está empacando. No salió todavía.

Nadie en el mercado — ni Opera, ni Mews, ni Cloudbeds — ha resuelto el gap entre "el checkout está programado" y "el huésped físicamente ya no está".

**Zenix lo resuelve con el único flujo de 2 fases del mercado:**

**Fase 1 — 7:00 AM, Planificación:**
El recepcionista abre el panel del día (que se alimenta del calendario) y ve todas las salidas programadas. Marca qué camas salen hoy. El sistema crea las tareas internamente pero no activa nada — el housekeeper no recibe ninguna notificación. El huésped sigue durmiendo.

**Fase 2 — 11:00 AM, Confirmación física:**
Cuando el huésped entrega las llaves, el recepcionista toca el chip de esa cama. En ese momento exacto, el sistema notifica al housekeeper en su celular: "Cama 2 del Dorm 4 lista para limpiar." No antes. No después.

**Resultado operativo:** cero housekeepers en habitaciones con huéspedes. Cero tiempo muerto esperando confirmaciones. El housekeeper solo va cuando el cuarto realmente está listo.

---

### Si el recepcionista se equivoca — reversión en 5 segundos

Confirmó la salida pero el huésped volvió porque olvidó algo. Con Opera o Cloudbeds: la tarea ya se activó, hay que cancelarla manualmente y notificar al housekeeper por WhatsApp.

Con Zenix: botón "↩ Revertir salida". El sistema cancela la tarea, notifica al housekeeper para que no vaya, y la habitación vuelve al estado anterior. Todo en 5 segundos. Queda registrado quién revirtió y cuándo.

---

### Gestión por cama — la realidad de los hostales

Si tienes un dormitorio de 6 camas y solo 3 personas salen hoy, no quieres limpiar todo el cuarto. Solo las 3 camas desocupadas.

Zenix gestiona cada cama de forma completamente independiente:
- Cama 1: sale hoy, entra alguien esta tarde → **urgente** (el housekeeper lo sabe con un ícono)
- Cama 2: sale hoy → limpieza normal
- Cama 3: sigue ocupada → cero tareas generadas

Ningún otro PMS del mercado hace esto de forma nativa. Mews lo intenta pero no tiene la granularidad per-bed completa que tiene Zenix. Para un hostal, esto puede representar 30-40% menos tiempo de limpieza al día.

---

### App móvil para el housekeeper — funciona sin internet

El housekeeper tiene una app en su celular que muestra exactamente sus tareas asignadas. Cuando llega al cuarto toca "Iniciar", cuando termina toca "Finalizar". El supervisor ve el progreso en tiempo real en su pantalla del calendario.

**Lo que ningún otro PMS ofrece: modo offline.** Si el housekeeper está en un piso sin señal, la app sigue funcionando. Las acciones se guardan localmente y se sincronizan cuando recupera la conexión. Para hoteles con wifi inconsistente en los pisos superiores, esto no es un nice-to-have — es una necesidad operativa.

---

### Notificaciones push — sin depender de grupos de WhatsApp

Cuando una habitación está lista para limpiar, el housekeeper recibe una notificación push en su celular al instante. No necesita revisar la app. No necesita esperar que alguien le mande un mensaje. El sistema lo notifica solo, con el número de cuarto y la prioridad.

---

### Lo que ve el supervisor en tiempo real

El supervisor tiene una vista de todas las tareas del día:
- Cuántas habitaciones están pendientes, en proceso, terminadas, o verificadas
- Quién está limpiando qué cuarto y cuánto tiempo lleva
- Cuáles están listas esperando su verificación

La verificación es un click: la tarea pasa de "Terminada" a "Verificada". Queda registro de quién verificó y cuándo. Es el mismo estándar de auditoría que Opera Cloud — disponible en Zenix.

---

## Módulo 2 — Gestión de No-Shows

> Este es el módulo donde Zenix supera a todos los competidores, incluyendo Opera Cloud y Mews.

### El ciclo completo — Zenix cubre 5 fases que la competencia ignora

#### Fase 1 — 20:00: Detección temprana y outreach automático (solo Zenix)

A las 8 de la noche (hora local configurable por propiedad), si un huésped no ha llegado, el sistema lo detecta. Lo que pasa automáticamente:

1. El bloque de esa reserva en el calendario cambia a color ámbar — señal visual de alerta para el recepcionista
2. El sistema envía un **WhatsApp automático al huésped** preguntando si llega tarde
3. El sistema envía también un **email automático** de recordatorio
4. Cada intento de contacto queda registrado en un log inmutable con timestamp, canal, y preview del mensaje

**Por qué el WhatsApp importa:** en México, Colombia y Argentina, WhatsApp tiene más del 85% de tasa de apertura frente al 20% del email. Un mensaje a las 8 PM convierte potenciales no-shows en llegadas tardías — elimina el costo del cargo antes de que exista y mantiene la relación con el huésped.

**Ningún PMS del mercado tiene esto.** Opera, Mews, Cloudbeds, Clock PMS+ — ninguno.

---

#### Fase 2 — El log de contacto: tu defensa ante un chargeback

Cada intento de contacto genera un registro que **nunca se puede borrar ni modificar**:

```
Canal: WhatsApp
Enviado: 2026-04-23 20:15 hora local
Mensaje: "Hola, notamos que aún no has llegado al hotel..."
Por: Sistema automático
```

Este log es exactamente lo que Visa y Mastercard piden cuando un huésped disputa un cargo de no-show: "El establecimiento intentó contactar al titular antes de aplicar el cargo." Sin este log, el hotel pierde la disputa. Con él, la gana. **Ningún PMS del mercado tiene este registro estructurado con este nivel de detalle.**

---

#### Fase 3 — Night audit multi-timezone

A las 2 AM de cada ciudad (configurable), el sistema ejecuta el cierre nocturno y marca los no-shows automáticamente.

**El bug que tiene toda la competencia:** Cloudbeds, Mews, Clock PMS+ corren el night audit a la misma hora UTC para todas las propiedades. Para un hotel en México eso puede ser las 8 PM hora local — aún horario operativo. Es un bug documentado en foros de usuarios de Cloudbeds que afecta a cadenas con hoteles en múltiples países.

**Zenix lo resuelve:** cada propiedad tiene su propia zona horaria configurada. El sistema evalúa cada propiedad de forma independiente a la hora local correcta. Una cadena con hoteles en Cancún, Bogotá y Madrid funciona desde el día 1 sin configuración extra.

---

#### Fase 4 — Registro fiscal inmutable

Cuando se marca un no-show, el sistema registra permanentemente: quién lo marcó, cuándo, la razón, el monto del cargo, la moneda (ISO 4217: MXN, COP, USD), y el estado del cobro. Este registro **nunca se puede borrar**. Si el SAT audita cualquier cargo de no-show de los últimos 5 años, el hotel tiene el reporte en segundos.

El reporte de no-shows es exportable a CSV — directo al contador para el CFDI 4.0, DIAN (Colombia), o SUNAT (Perú).

---

#### Fase 5 — Revertir, cobrar, o perdonar — todo auditado

**Revertir:** ventana de 48 horas para revertir un no-show marcado por error. Queda registrado quién lo revirtió, cuándo, y por qué. La habitación vuelve a estar ocupada al instante.

**Perdonar un cargo:** si el gerente decide no cobrar por cortesía, puede hacerlo — pero debe escribir la razón. Queda documentado quién perdonó y por qué. Cuando el auditor pregunta "¿por qué este cargo no fue cobrado?", la respuesta está en el sistema.

Mews tiene reversión pero sin razón obligatoria ni cumplimiento fiscal LATAM. Cloudbeds no tiene reversión auditada. **Zenix es el único sistema con el ciclo completo: detección + outreach + audit trail + reversión + cumplimiento fiscal regional.**

---

## Módulo 3 — Protección contra Overbooking

### Tres capas de defensa

**Capa 1 — Hard block transaccional (activo hoy)**

Toda reserva que intenta confirmarse — venga del recepcionista, de Booking.com, de Hostelworld, o de cualquier OTA vía webhook — pasa por una verificación de disponibilidad antes de guardarse. Si hay conflicto, la segunda reserva se rechaza con un mensaje que explica qué huésped ya ocupa esa habitación y hasta cuándo. No hay overbooking silencioso. El recepcionista siempre sabe qué pasó.

**Capa 2 — Sincronización con Channel Manager Channex.io (próximamente)**

Cuando se confirma una reserva en Zenix, el sistema notifica a Channex.io en tiempo real. Channex actualiza la disponibilidad en todas las OTAs conectadas en segundos. La habitación desaparece de Booking.com y Hostelworld antes de que otro huésped pueda confirmar. Es el mismo estándar que Opera Cloud y Mews.

**Capa 3 — Soft-lock entre recepcionistas (activo hoy)**

Si dos recepcionistas del mismo hotel abren el mismo cuarto simultáneamente, el primero activa un badge visible para el otro: "🔒 En uso por María G." El segundo recepcionista sabe inmediatamente que alguien ya está gestionando esa habitación. Sin esta capa, ambos ven "disponible" y el que confirma segundo recibe un error confuso sin explicación.

---

### El escenario real: recepcionista + Hostelworld al mismo tiempo

Con Channex activo:
> El recepcionista confirma la Hab. 205. En 1 segundo, Zenix notifica a Channex. En 2 segundos, la habitación desaparece de Hostelworld. El huésped que estaba buscando en Hostelworld ya no puede confirmarla. ✅

Sin Channex (hoy):
> El huésped confirma en Hostelworld. El webhook llega a Zenix. El hard block detecta el conflicto y rechaza la reserva de Hostelworld automáticamente. El overbooking nunca ocurre. ✅

**Resultado en ambos casos: cero overbooking.** La diferencia es si el huésped en Hostelworld ve el cuarto indisponible antes o después de intentar confirmarlo.

---

## Módulo 4 — Reportes y Trazabilidad

### El dashboard del supervisor

Vista de métricas del día en tiempo real: habitaciones limpias, en proceso, pendientes. No-shows del día y monto potencial de cargos. Historial de checkouts.

### El reporte de no-shows para el contador

Filtrable por rango de fechas: cada no-show con nombre, habitación, monto del cargo, estado del cobro, y quién lo procesó. Suma separada de cobrados vs. perdonados — el contador ve exactamente qué entra como ingreso y qué fue cortesía. Exportable a CSV para CFDI 4.0.

### El historial de cada reserva

Cada reserva tiene un historial cronológico de todos sus eventos: creación, modificaciones, traslados de habitación, check-in, check-out, no-show, reversiónm intentos de contacto. Cuando un huésped abre una disputa, el recepcionista tiene toda la evidencia en 10 segundos.

---

## Módulo 5 — Configuración Multi-Propiedad

Una cuenta de Zenix gestiona múltiples propiedades. Cada propiedad tiene configuración independiente: zona horaria propia, hora de corte de no-shows, política de cargo, y activación del outreach automático. El gerente corporativo ve todas sus propiedades. El recepcionista de cada hotel ve solo la suya.

---

## Próximamente — Módulo de Mantenimiento

El housekeeper es quien entra a cada habitación todos los días — es el primero en ver un grifo roto, una lámpara fundida, o una mancha. Hoy ese reporte llega por WhatsApp y se pierde.

Próximamente: desde la app del housekeeper, al terminar una limpieza puede reportar un problema con una foto. El sistema crea un ticket automáticamente. El supervisor de mantenimiento lo recibe. Cuando se resuelve, el sistema notifica al área de housekeeping que la habitación ya está accesible.

El resultado: cero incidencias de mantenimiento que caen en el olvido. Un registro histórico por habitación para decisiones de renovación. La trazabilidad de Opera Cloud para el hotel boutique.

---

## Los argumentos de cierre

### Para hoteles que usan Opera Cloud o Mews hoy

> "Opera y Mews son excelentes — Zenix tiene el mismo nivel técnico. La diferencia es el precio y el diseño: ellos están hechos para cadenas con equipos de IT. Zenix está hecho para que un recepcionista lo opere solo, desde el primer día, sin capacitación técnica."

### Para hoteles que usan Cloudbeds o Clock PMS+ hoy

> "Cloudbeds te da el calendario y las integraciones de OTAs. Pero cuando tienes un no-show y el banco te pide evidencia, ¿qué tienes? Zenix tiene el timestamp del WhatsApp que el sistema envió al huésped a las 8 PM, el log del intento de cobro, y el historial auditado completo. Eso es lo que gana un chargeback."

### Para hoteles que usan Excel o papel hoy

> "Cada habitación que se limpia sin confirmación digital es una habitación que puede estar mal limpiada y nadie lo sabe. Cada no-show gestionado por WhatsApp es un cargo que no puedes cobrar si el huésped disputa con el banco. Zenix resuelve ambos problemas en el mismo sistema."

### Para hostales con dormitorios compartidos

> "Ningún PMS del mercado — ni Opera, ni Mews, ni Cloudbeds — gestiona por cama de verdad. Zenix es el único construido desde el principio para la realidad del hostal: la Cama 1 y la Cama 3 del mismo dorm pueden tener estados, huéspedes y tareas completamente distintos."

### Para cadenas con hoteles en múltiples países

> "¿Tu PMS actual corre el cierre nocturno a la misma hora para el hotel en Cancún y el de Madrid? Porque si es así, uno de los dos está cortando en horario operativo. Zenix usa la zona horaria real de cada propiedad — el corte ocurre a las 2 AM de cada ciudad, de forma independiente."

---

## Resumen ejecutivo

| Si el hotel necesita... | Zenix lo resuelve porque... |
|---|---|
| Ver el estado del hotel de un vistazo | Calendario PMS visual en tiempo real con SSE |
| No limpiar habitaciones con huéspedes adentro | Checkout de 2 fases: planificación AM + confirmación física |
| Gestionar camas individuales en dormitorios | Arquitectura per-bed nativa — única en el mercado |
| Housekeepers que siempre saben qué hacer | Push notifications instantáneas + app móvil offline |
| Protegerse de chargebacks por no-show | GuestContactLog + audit trail fiscal + export CSV |
| Operar hoteles en múltiples países | Night audit multi-timezone por propiedad (hora local real) |
| Cumplimiento fiscal en LATAM | Registros inmutables + CFDI-ready + moneda ISO |
| Cero overbooking con OTAs | Hard block transaccional + Channex.io (mismo estándar Opera/Mews) |
| Trazabilidad ante disputas | Audit trail con actor, timestamp y razón en cada operación |
| Un sistema que los housekeepers realmente usen | App diseñada para uso con una mano, en movimiento, sin capacitación |

---

*Documento basado en las funcionalidades implementadas y en roadmap de Zenix PMS. Actualizar con cada sprint completado.*
