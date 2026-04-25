# Zenix PMS — Documento Maestro de Ventas

> **Para uso interno del equipo comercial.**
> Este documento es el mapa completo de funcionalidades de Zenix PMS. Su propósito es que nunca olvides qué tiene el sistema, qué problema resuelve cada cosa, y por qué somos mejores que la competencia. No es técnico — es la fuente de tu speech.
>
> Última actualización: 2026-04-25 — Sprint 8F completado (Ventana temporal de no-show con día hotelero real)

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
| Coordinación en tiempo real entre recepcionistas | ❌ | ❌ | ❌ | ❌ | ✅ badge 🔒 SSE |
| Auto-detección de conflicto al extender estadía | ❌ | ❌ | ❌ | ❌ | ✅ con cuartos alternativos |
| Gestión por cama (no solo por habitación) | ❌ | ⚠️ parcial | ❌ | ❌ | ✅ |
| Checkout de 2 fases (planificación + confirmación física) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Reversión de salida confirmada por error | ❌ | ❌ | ❌ | ❌ | ✅ |
| App móvil offline para housekeepers | ❌ | ❌ | ❌ | ❌ | ✅ |
| Pre-arrival warming con WhatsApp automático | ❌ | ❌ | ❌ | ❌ | ✅ |
| Log de contacto al huésped (evidencia chargeback) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Night audit multi-timezone por propiedad | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cumplimiento fiscal CFDI 4.0 / DIAN / SUNAT | ❌ | ❌ | ❌ | ❌ | ✅ |
| Ventana temporal de no-show (día hotelero real, no medianoche) | ❌ | ❌ | ❌ | ❌ | ✅ configurable por propiedad |
| Reversión de no-show desde tooltip del calendario (< 48h) | ❌ | ❌ | ❌ | ❌ | ✅ botón ámbar en 1 click |
| Reversión de no-show auditada con razón y actor | ❌ | ⚠️ sin razón | ❌ | ⚠️ sin actor | ✅ |
| Cargo perdonado con razón auditada | ❌ | ❌ | ❌ | ❌ | ✅ |
| Confirmación física de llegada del huésped (anti ghost check-in) | ❌ | ❌ | ❌ | ❌ | ✅ wizard 4 pasos |
| Audit trail de pagos en recepción (append-only, USALI 12ª ed.) | ❌ | ⚠️ básico | ❌ | ❌ | ✅ |
| Control de efectivo por turno (cash reconciliation) | ❌ | ❌ | ❌ | ❌ | ✅ con voids auditados |
| Aprobación de gerente para cortesías y exenciones (COMP) | ❌ | ❌ | ❌ | ❌ | ✅ obligatorio |
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

**La parte que ningún otro PMS tiene:** si el cuarto original ya tiene otra reserva en esas fechas, el sistema lo detecta automáticamente — antes de que el recepcionista llegue siquiera al panel de confirmación — y ofrece cuartos alternativos del mismo tipo (misma categoría: dorm, privada, suite). El recepcionista elige del listado, confirma, y el sistema gestiona todo: el traslado al nuevo cuarto, el ajuste de precio, el registro en el historial y la notificación a housekeeping. El huésped se entera del cambio de cuarto, no de la logística detrás.

Ningún otro PMS del mercado hace este auto-detect en el momento del gesto. En Opera y Mews el recepcionista descubre el conflicto al intentar confirmar — recibe un error y tiene que empezar desde cero eligiendo otra habitación manualmente.

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

### El ciclo completo — Zenix cubre 6 fases que la competencia ignora

#### Fase 0 — La lógica del día hotelero (solo Zenix entiende esto)

Antes de hablar de no-shows, hay que entender una realidad operativa que **ningún PMS del mercado ha implementado correctamente**: el día hotelero no termina a medianoche. Termina en el night audit, típicamente a las 2:00 AM.

¿Qué significa en la práctica? Si un huésped tiene check-in el lunes y son las 1:00 AM del martes, sigue siendo "el lunes hotelero". El huésped puede aparecer con retraso de vuelo — es una situación normal. Zenix sabe esto y actúa en consecuencia:

**La regla en tres franjas:**

| Horario | ¿Qué ve el recepcionista? |
|---------|--------------------------|
| Llegada – 19:59 (hora local) | Solo "Confirmar check-in" — el sistema bloquea marcar no-show antes de tiempo |
| 20:00 – ~02:00 del día siguiente | Ambas opciones: "Confirmar check-in" Y "Marcar no-show" coexisten |
| Después del night audit (~02:00) | Solo "Revertir no-show" si el sistema ya lo procesó automáticamente |

**Por qué esto importa en ventas:** ningún PMS del mercado protege al recepcionista de tomar una mala decisión a las 4 PM. Un no-show marcado a las 4 PM con el huésped en un vuelo retrasado es una disputa de chargeback garantizada — y el hotel la pierde. **Zenix previene esta situación por diseño: el sistema simplemente no permite marcar no-show antes de la hora configurada.**

Además, si son las 1 AM y el huésped no ha llegado, Zenix muestra el bloque en ámbar (`Sin confirmar`) — no en verde (`En casa`). Los demás sistemas asumen que si el check-in era ayer el huésped ya está adentro. Zenix sabe que dentro del mismo "día hotelero" aún puede estar en camino.

---

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

**Capa 3 — Coordinación en tiempo real entre recepcionistas (activo hoy)**

En hoteles con más de un recepcionista — algo muy común en temporada alta — puede ocurrir que dos personas estén gestionando la misma habitación al mismo tiempo sin saberlo. Zenix resuelve esto con un sistema de señalización en tiempo real:

En el momento en que un recepcionista abre el dialog de una habitación (sea para crear una reserva nueva o para gestionar una existente), aparece inmediatamente un badge **🔒 "En uso por [nombre]"** en la fila de esa habitación en el calendario — visible para todos los demás recepcionistas conectados.

El badge es informativo, no bloqueante. Esto es intencional:
- Si el recepcionista B quiere reservar la **misma habitación en fechas distintas**, puede hacerlo sin problema — el sistema verificará disponibilidad y la reserva se creará sin conflicto
- Si las fechas se superponen y ambos intentan confirmar, el hard block del servidor rechaza automáticamente al segundo con un mensaje claro que explica el conflicto
- El badge desaparece automáticamente cuando el recepcionista cierra el dialog

**Para el speech de ventas:** ningún PMS entry-level del mercado tiene este mecanismo de coordinación visual en tiempo real. En Cloudbeds o Clock PMS+, dos recepcionistas pueden estar trabajando en la misma habitación en silencio absoluto — el primero en confirmar gana, el segundo recibe un error genérico sin contexto. En Zenix, el segundo recepcionista ve el badge antes de iniciar su proceso y puede tomar una decisión informada.

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

## Módulo 6 — Check-in Confirmado + Anti-fraude en Recepción

> El módulo que cierra el último punto ciego del ciclo operativo: ¿el huésped que figura como "alojado" realmente llegó? ¿El efectivo cobrado quedó registrado?

### El problema: ghost check-ins y robo en caja

En todos los PMS del mercado — incluidos Opera y Mews — el sistema marca a un huésped como "en casa" basándose únicamente en las fechas. Si el check-in programado es hoy, el sistema asume que llegó. Esto genera:

- **Ghost check-ins:** huéspedes que figuran como "alojados" pero nunca llegaron. La habitación aparece ocupada durante días sin que nadie lo detecte hasta el cierre.
- **No-shows tardíos:** el recepcionista no tiene señal visual de que el huésped del día aún no ha sido confirmado — mezcla huéspedes reales con llegadas pendientes.
- **Efectivo no registrado:** sin un punto de registro de pago en el momento de la llegada, un recepcionista deshonesto puede cobrar en mano y no registrar nada. La ACFE documenta que el 40% del fraude en hotelería ocurre exactamente aquí — promedio de $140,000 USD por incidente.

### La solución: wizard de check-in de 4 pasos

Cuando llega un huésped cuyo check-in es hoy, en el calendario aparece un badge ámbar **"Sin confirmar"** sobre su bloque. El recepcionista inicia el proceso desde el tooltip o desde el panel lateral.

El wizard guía al recepcionista por 4 pasos:

**Paso 1 — Verificación de datos:** toda la información de la reserva aparece pre-llenada (nombre, fechas, canal, número de huéspedes). El recepcionista la confirma y puede completar el número de documento si falta.

**Paso 2 — Identidad:** el recepcionista marca el checkbox "Documento verificado". El wizard no avanza sin esta confirmación — es el forcing function que garantiza que nadie entre sin identificarse.

**Paso 3 — Pago:** si hay saldo pendiente, el recepcionista registra el método de pago:
- Efectivo
- Terminal POS (referencia del voucher — nunca datos de tarjeta)
- Transferencia bancaria (con referencia)
- Prepago OTA (el sistema lo confirma sin cargo adicional)
- Cortesía/COMP — **requiere código y razón de aprobación de gerente**, sin excepción

**Paso 4 — Resumen y confirmación:** preview de todos los cambios que se van a aplicar. Un solo botón "Confirmar check-in" ejecuta todo en una transacción: el badge cambia a "Alojado" (emerald) en tiempo real para todos los recepcionistas, housekeeping recibe notificación de que el huésped ya está instalado.

---

### Audit trail de pagos — USALI 12ª edición

Cada pago registrado en el check-in genera un `PaymentLog` que cumple con la norma USALI 12ª edición (vigente desde enero 2026):

- **Append-only:** el registro nunca se modifica. Si hay un error, se crea un registro de void (negativo) que referencia al original. El registro original permanece intacto para auditoría.
- **Actor obligatorio:** cada pago registra quién cobró (`collectedById`) y la fecha del turno (`shiftDate`) — para cierre de caja por turno.
- **COMP con aprobación:** si el método es "Cortesía", el sistema exige código de aprobación y razón del gerente antes de guardar. El bypass es técnicamente imposible — el backend rechaza la operación si faltan estos campos.

---

### Cash reconciliation al cierre de turno

El supervisor puede consultar en cualquier momento el resumen de efectivo del turno:
```
GET /cash-summary?date=2026-04-24
```
El resultado muestra: total de efectivo cobrado, por recepcionista, con cada transacción individual. Si el efectivo físico en caja no cuadra con el registro del sistema, hay una discrepancia investigable — con nombre, hora, y monto exacto.

**Por qué esto importa en LATAM:** a diferencia de mercados donde el 90% de los pagos son con tarjeta, en México y Colombia el efectivo sigue siendo el método principal en hoteles boutique. Sin este control, cada turno de noche es un punto ciego financiero.

---

### Para el speech de ventas

> "¿Sabes cuántos de los huéspedes que tu PMS marca como 'alojados' hoy realmente están en el hotel? Zenix es el único sistema en el mercado que exige una confirmación explícita de llegada — con documento verificado y pago registrado — antes de cambiar el estado a 'En casa'. Sin esa confirmación, el badge queda en ámbar. No hay ghost check-ins. No hay efectivo que se pierde en el camino."

> "La ACFE dice que el robo más común en hotelería es el recepcionista que cobra en efectivo y no registra nada. Zenix cierra ese hueco: cada peso cobrado queda registrado con nombre, hora, y turno. Al final del día el supervisor compara el efectivo físico con el registro del sistema. Cualquier discrepancia tiene dueño."

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

### Para hoteles con recepción de efectivo

> "En LATAM el efectivo sigue siendo el método principal. Sin un registro por turno, cada noche es un punto ciego financiero. Zenix registra cada peso cobrado — quién lo cobró, a qué hora, en qué turno. Al cierre el supervisor compara caja física con sistema. Si no cuadra, el sistema ya sabe quién cobró en ese rango."

### Para hoteles que han tenido problemas con ghost check-ins o no-shows mal gestionados

> "¿Cuántos huéspedes tiene tu sistema marcados como 'alojados' que en realidad nunca llegaron? Con Zenix, eso no ocurre: el sistema distingue entre 'check-in programado' y 'check-in confirmado'. Un huésped sin confirmación de llegada aparece en ámbar, no en verde. El night audit lo detecta como potencial no-show automáticamente."

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
| Confirmar que el huésped realmente llegó | Badge "Sin confirmar" en calendario + wizard de check-in de 4 pasos |
| Control de efectivo sin riesgo de robo en caja | PaymentLog append-only por turno + cash reconciliation al cierre |
| Cortesías y exenciones sin bypass posible | COMP requiere código + razón de gerente — backend lo exige sin excepción |
| Cumplimiento USALI 12ª edición en pagos | Registros de pago inmutables con voids auditados — vigente desde ene 2026 |

---

*Documento basado en las funcionalidades implementadas y en roadmap de Zenix PMS. Actualizar con cada sprint completado.*
