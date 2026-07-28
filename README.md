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
- 6 castle tiles.
- First player to control 4 castles wins.
- Context-sensitive board controls:
  - click a friendly knight to select or deselect it
  - click a legal intersection to move
  - click a valid edge to build a wall
  - click a breakable enemy wall to destroy it
  - click a valid hex center to build a castle
- Knights protect adjacent friendly walls from destruction.
