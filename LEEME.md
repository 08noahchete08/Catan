# ⛵ Los Colonos de Catán (con ampliación 5-6 jugadores)

Juego completo para el navegador: partida **local** (contra la IA o pasándose el turno) y partida **online** para jugar con amigos desde casa.

## Reglas configurables

Al crear la partida (local u online) se puede elegir:

- **Puntos para ganar:** de 5 a 20 (10 es lo normal).
- **Regla para 5-6 jugadores:**
  - **Turnos en pareja (oficial 2023):** tras cada turno, el jugador emparejado (el 3.º a la izquierda, enfrente con 6) puede construir, comerciar con el banco y jugar una carta, sin tirar dados ni comerciar con jugadores.
  - **Fase especial de construcción (clásica):** tras cada turno, todos los demás pueden construir.
  - **Sin regla extra.**
- **Cortar caminos:** si se desactiva, no se puede construir un poblado donde pasa el camino de otro jugador.
- **Variantes** (combinables): ladrón amistoso, cartas de eventos y maestro del puerto.
- **Expansiones** (una a la vez):
  - **Navegantes de Catán:** mapa con isla principal e islas nuevas generado al azar, barcos (madera + lana), mover un barco por turno, ríos de oro, pirata y +2 puntos por colonizar cada isla nueva. Recomendado: 12-14 puntos.
  - **Ciudades y Caballeros:** mercancías (papel, tela, moneda), dado de eventos, ataques de los bárbaros, caballeros (construir, ascender, activar, mover, desplazar y expulsar al ladrón), mejoras de ciudad con sus habilidades, metrópolis, murallas y las 54 cartas de progreso. Recomendado: 13 puntos.
  - **Mercaderes y Bárbaros** (un escenario a elegir):
    - **Pescadores de Catán:** lago y caladeros dan fichas de pescado para mover el ladrón (2), robar (3), tomar un recurso (4), construir un camino (5) o tomar una carta de desarrollo (7). Quien tenga la bota vieja necesita 1 punto más.
    - **Ríos de Catán:** construir junto a los ríos da monedas y los puentes (2 arcilla + 1 madera) dan 3. Con 2 monedas se compra un recurso. El más rico gana 1 punto; los más pobres pierden 2.
    - **Caravanas:** tras cada poblado o ciudad se vota con trigo y lana dónde va un camello. Los edificios en una ruta de camellos valen +1 y esos caminos cuentan doble para la Gran Ruta.
    - **Ataque de los bárbaros:** cada poblado o ciudad atrae 3 bárbaros a la costa; con 3 un hexágono queda conquistado. Las cartas de Caballero despliegan caballeros en el castillo, que mueven 3 pasos (+2 con trigo) y capturan bárbaros (2 prisioneros = 1 punto).

## Jugar en local

Abre `index.html` con doble clic. No necesitas instalar nada.

## Jugar online

Necesitas **Node.js 18 o superior** (https://nodejs.org). El servidor no usa dependencias externas.

1. Abre una terminal en esta carpeta y ejecuta:

   ```bash
   node server.js
   ```

2. Entra en **http://localhost:3000**, escribe tu nombre y pulsa **Crear partida online**.
3. Comparte el **código de 4 letras** o el **enlace** de la sala. Tus amigos lo abren, escriben su nombre y pulsan **Unirse**.
4. Como anfitrión, puedes añadir jugadores IA para completar la mesa (de 3 a 6) y luego pulsar **Comenzar partida**.

Mientras juegas, el servidor tiene que seguir en marcha. Para cerrarlo pulsa `Ctrl + C` en la terminal.

### Cómo pueden entrar tus amigos

El servidor se ejecuta en tu ordenador, así que tus amigos necesitan llegar hasta él:

- **Misma red wifi:** al arrancar, el servidor muestra una dirección del tipo `http://192.168.1.45:3000`. Compártela. Si Windows pregunta por el firewall, permite el acceso en redes privadas.
- **Por Internet, sin configurar nada (recomendado):** usa un túnel gratuito. Con Cloudflare (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/):

  ```bash
  cloudflared tunnel --url http://localhost:3000
  ```

  Aparecerá una dirección `https://algo.trycloudflare.com`. Pásasela a tus amigos (con `?sala=CÓDIGO` al final si quieres que el código aparezca ya escrito).
- **Alojarlo siempre en línea:** sube esta carpeta a un servicio que ejecute Node.js, como Render, Railway o Fly.io. Usa `npm start` como comando de inicio. El puerto se toma de la variable `PORT`.

## Instalarlo en tu propio dominio

Necesitas un servidor donde puedas ejecutar **Node.js** de forma permanente (un VPS, o un hosting con «aplicaciones Node.js»). Un hosting que solo sirve páginas (HTML/PHP) vale para la partida local, pero no para la online.

### En un VPS (Ubuntu/Debian) con Nginx

1. Copia la carpeta al servidor (por ejemplo en `/opt/catan`) e instala Node.js 18 o superior.
2. Déjalo funcionando siempre como servicio. Crea `/etc/systemd/system/catan.service`:

   ```ini
   [Unit]
   Description=Catan online
   After=network.target

   [Service]
   WorkingDirectory=/opt/catan
   ExecStart=/usr/bin/node server.js
   Environment=PORT=3000
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```

   y actívalo con `sudo systemctl enable --now catan`.
3. Configura Nginx para tu dominio. Las líneas `Upgrade` y `Connection` son imprescindibles para la conexión en tiempo real:

   ```nginx
   server {
       server_name catan.midominio.com;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_read_timeout 3600s;
       }
   }
   ```

   Para ponerlo en una subcarpeta (`midominio.com/catan/`), usa `location /catan/ { proxy_pass http://127.0.0.1:3000/; ... }` con las mismas líneas.
4. Activa HTTPS, por ejemplo con `sudo certbot --nginx -d catan.midominio.com`. El juego usa automáticamente una conexión segura (`wss://`) cuando la página va por HTTPS.

### En Render, con tu dominio de Hostinger

1. **GitHub:** crea un repositorio y sube `index.html`, `server.js`, `package.json` y las carpetas `css` y `js`.
2. **Render** (https://render.com): *New → Web Service*, elige el repositorio. Comando de inicio: `npm start`; plan *Free*; en *Advanced*, *Health Check Path*: `/salud`.
3. **Dominio:** en Render, *Settings → Custom Domains → Add* `catan.tudominio.com`. En Hostinger (hPanel → Dominios → DNS), añade un registro **CNAME** con nombre `catan` que apunte a `tu-servicio.onrender.com`. Vuelve a Render y pulsa *Verify*.

En el plan gratuito, el servicio se duerme tras 15 minutos sin uso (la primera visita tarda alrededor de un minuto en despertarlo) y al reiniciarse se pierden las partidas en curso.

### En otros servicios (Railway, Fly.io…)

Sube la carpeta, usa `npm start` como comando de inicio y añade tu dominio en el panel del servicio (te pedirá crear un registro CNAME en tu DNS).

## Cómo funciona el modo online

- El servidor valida cada jugada con las mismas reglas que el juego local, así que nadie puede hacer trampas desde el navegador.
- Cada jugador solo recibe sus propias cartas. Del resto ve únicamente cuántas tiene.
- Si alguien se desconecta, a los 15 segundos la IA juega en su lugar. Al volver a abrir la página (en la misma pestaña) recupera su puesto.
- Para comerciar con otros jugadores: quien tiene el turno propone un intercambio, el resto acepta o rechaza en su pantalla y quien lo propuso elige con quién cerrar el trato.
- Hay chat en la sala de espera y durante la partida.
- Al terminar, el anfitrión puede volver a la sala para echar otra partida con la misma gente.

## Archivos

| Archivo | Contenido |
|---|---|
| `index.html`, `css/style.css` | Página y estilos |
| `js/board.js` | Generación del tablero (básico y ampliado) |
| `js/game.js` | Reglas del juego (compartidas por la partida local y el servidor) |
| `js/ai.js` | Jugadores IA |
| `js/ui.js` | Tablero, paneles y ventanas de la partida |
| `js/net.js` | Menú de inicio, sala de espera, conexión y chat |
| `server.js` | Servidor online |
