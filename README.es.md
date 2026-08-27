<div align="center">

# ⌨️ dsh-prompt-history

**Entrada estilo terminal para el compositor de la Web GUI de DeepSeek Harness: historial de prompts tipo bash, copiar y citar, y pegar con clic derecho.**

*Pulsa ↑ como en una terminal: historial, citas y pegado en un solo plugin.*

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#)
[![npm version](https://img.shields.io/npm/v/dsh-prompt-history)](https://www.npmjs.com/package/dsh-prompt-history)
[![npm downloads](https://img.shields.io/npm/dm/dsh-prompt-history)](https://www.npmjs.com/package/dsh-prompt-history)

[English](README.en.md) · [简体中文](README.md) · **Español** · [Português](README.pt.md)

</div>

---

## Compatibilidad

| Superficie | Estado |
|---|---|
| Plataforma | Solo Web GUI (plugin de cliente; estado local del navegador; sin red, sin código nativo) |
| Node | `>=20` |
| Modelo | Cualquiera (no hace peticiones al modelo — comportamiento de UI puro) |
| Idioma de la interfaz | 中文 / English (sigue el idioma de la app de DSH, se cambia en Ajustes) |

## Qué obtienes

`dsh-prompt-history` lleva el historial de una terminal al compositor de la Web GUI de DeepSeek Harness:

1. **Recuperación con flechas estilo shell** — con el borrador vacío, **↑** recupera el mensaje enviado más reciente (el más nuevo primero); **con un prefijo escrito, ↑ salta al mensaje más reciente que empiece con ese prefijo** (`history-search-backward` de bash); sigue pulsando ↑ para retroceder por las coincidencias; **↓** avanza (incluido el avance entre coincidencias de prefijo) y, al llegar al final, **restaura la línea que escribías antes de empezar a navegar** (comportamiento pending-line de readline).
2. **Editar sale de la navegación** — editar el borrador mientras navegas vuelve a la línea en vivo.
3. **Búsqueda inversa con Ctrl+R** — búsqueda incremental sobre el historial con coincidencia en vivo (superposición estilo bash `(reverse-i-search)`consulta``); Ctrl+R de nuevo va a la coincidencia anterior; Enter acepta, Escape cancela y restaura el borrador previo.
4. **Copiar + citar + código (tres modos, en Ajustes)** — cualquier selección no vacía de la página — el área de texto del compositor, mensajes del chat, bloques de código — se maneja según el modo elegido:
   - **Barra de herramientas** (predeterminado): aparecen botones Copiar / Citar / Código sobre la selección — copiar escribe en el portapapeles solo al hacer clic (sin inundar Win+V); **Citar** inserta el TEXTO COMPLETO seleccionado como un bloque de cita limpio con prefijo `>` en el compositor (se renderiza como cita al enviar); **Código** copia la selección envuelta en un bloque de código con ``` (estilo Codex).
   - **Auto** (estilo terminal): copia la selección directamente al portapapeles del sistema al seleccionar.
   - **Apagado**: las selecciones quedan intactas.
5. **Clic derecho pega directamente** — un clic derecho sobre el compositor pega el portapapeles — sin menú contextual, como en una terminal Linux. El pegado usa la misma canalización que Ctrl+V (las imágenes y las chips de referencia se comportan igual), con respaldo de Clipboard API cuando la ruta execCommand está bloqueada.
6. **Historial entre sesiones** (interruptor en Ajustes, apagado por defecto) — mantiene el historial de ↑/↓ entre sesiones, almacenado en localStorage (límite 200), sobrevive a recargas y cambios de sesión.
7. **TOC del chat (índice de la conversación)** — cuando la conversación se hace larga, una pequeña manija semitransparente y arrastrable en el borde izquierdo del chat (se ilumina al pasar el cursor) despliega un índice de cada mensaje de usuario en orden — haz clic en cualquier entrada para saltar a ese punto; haz clic fuera o pulsa Esc para cerrar. Se puede desactivar en Ajustes.

Comportamiento de UI puro: sin eventos de sesión, sin cambios en el bucle del agente, sin peticiones al modelo. El texto recuperado o citado solo entra en el borrador normal del compositor — llega al modelo solo si *tú* pulsas Enter.

## Inicio rápido

```sh
# 1. instala el bundle en tu perfil
dsh plugin --profile web add dsh-prompt-history

# 2. recarga la página — no hace falta reiniciar el servicio
```

## Instalar y desinstalar

- **Canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-prompt-history`
- **Canal git** (desarrollo local, último `main`): `dsh plugin --profile web add "github:Xiaofei-fei/dsh-prompt-history#main"` (un checkout de código debe compilarse primero — `pnpm run build`; un bundle sin compilar se niega a arrancar)
- **Desinstalar**: `dsh plugin --profile web remove dsh-prompt-history`

## Configuración

Abre **Ajustes → `>_ Terminal Input`** (almacenado en localStorage del navegador, efectivo al instante):

| Opción | Predeterminado | Significado |
|---|---|---|
| Modo de copia (al seleccionar) | `Barra de herramientas` | `Barra` (recomendado; escribe en el portapapeles solo al hacer clic) / `Copiar automático al seleccionar` (estilo terminal) / `Apagado` |
| Historial entre sesiones | Apagado | El historial de ↑/↓ persiste entre sesiones en localStorage (límite 200) |
| TOC del chat | Activado | Mostrar la manija arrastrable en el borde izquierdo del chat; se puede desactivar |
| Pegar con clic derecho | Activado | Apagado restaura el menú contextual nativo del navegador |

El historial de ↑/↓ siempre está activo, independientemente de estos interruptores.

## Características

- **El historial proviene del registro de mensajes de la propia sesión**: lee los nodos de usuario (`user` / `steering`) de la instantánea de la conversación y los añade según llegan — estrictamente consistente con la transcripción, persistido con la sesión, sobrevive a recargas de página y no necesita configuración ni almacenamiento extra.
- **Los duplicados consecutivos se colapsan**; el estado de navegación se reinicia al cambiar de sesión.
- **Interfaz internacionalizada**: cada texto (ajustes, barra de herramientas, avisos, TOC, superposición de búsqueda) sigue el idioma de la app de DSH (中文 / English).
- El bundle de cliente pesa ~12 KB comprimido y depende solo de los paquetes peer oficiales `@deepseek-ai/*`.

## Limitaciones conocidas

- **Ctrl+R**: con el compositor enfocado, Ctrl+R es búsqueda inversa — ya no recarga la página (haz clic fuera del campo primero para recargar).
- Al cambiar de sesión, solo se pueden recuperar los mensajes de la ventana de eventos actualmente cargada (todo lo enviado con la página abierta está incluido); no hay búsqueda de historial del lado del host.
- Solo texto plano: los mensajes con solo imágenes o chips no se recuperan; los borradores recuperados son texto plano.

## Desarrollo

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsc (lib/types) + tsdown (lib/index.js / lib/invariant.js / lib/client.js)
```

La mitad del navegador (`src/client/`) se registra en el slot `conversation.input.right`; el build emite el formato de cierre `__ModuleLoader__` de DSH con `react` como única dependencia externa (todo lo demás viene de la tabla de módulos del navegador). Los diccionarios viven en `src/client/locales.ts` (`zh` autoritativo, `en` con paridad de claves) y se registran con `ctx.locale.register`.

## Cómo funciona

El plugin es una entrada de slot invisible del compositor que monta un listener `keydown` en fase de captura en el documento. Toma el control de ↑/↓ solo cuando el objetivo es el área de texto del compositor, no hay modificadores pulsados, no hay composición IME activa, no hay menú de sugerencias abierto y la sesión no está ocupada — entonces escribe el texto recuperado con `inputActions.setDraft`. La lista de historial se alimenta de los nodos `user`/`steering` de la instantánea (deduplicados por seq); la posición de navegación (índice más la línea pendiente de restaurar) vive en refs del componente.

## Licencia

[MIT](LICENSE)
