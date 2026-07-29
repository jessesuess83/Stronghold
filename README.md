# Stronghold

A browser-playable prototype of Knights Territory, a two-player abstract strategy game played on a hex board.

## Play locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then visit `http://127.0.0.1:4173/`.

## Current rules implemented

- Side-4 hex board with opposite capital cities.
- 5 knights and 40 walls per player.
- 3 reserve castle tiles per player.
- First player to control 4 castles wins.
- Context-sensitive board controls:
  - click a friendly knight to select or deselect it
  - click a legal intersection to move
  - click a valid edge to build a wall
  - click a breakable enemy wall to destroy it
  - click a valid hex center to build a castle
- Knights protect adjacent friendly walls from destruction.


## Online multiplayer

This repo includes a first-pass Socket.IO multiplayer server in `server/`.

Render setup:

- Create a new Render Web Service from this GitHub repo.
- Set the root directory to `server`.
- Build command: `npm install`
- Start command: `npm start`
- After Render gives you a service URL, update `ONLINE_SERVER_URL` in `game.js` if it differs from `https://stronghold-online.onrender.com`.

Online play flow:

- Click `Online Game` to create a room.
- Click `Copy Link` and send it to the other player.
- Opening the link with `?game=ROOMID` joins the room automatically.

The first online version stores active games in server memory. If the Render server restarts, active rooms disappear.
