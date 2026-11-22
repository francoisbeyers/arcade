# Battleships

A retro 8-bit, two-player Battleships game that runs in the browser. Each player uses their own device; there are no accounts and nothing to install.

## How it works

- One player taps **NEW GAME** and gets a 5-character room code (or shares an invite link).
- The other player enters the code and taps **JOIN GAME**.
- The two browsers connect directly to each other over WebRTC using [PeerJS](https://peerjs.com/). PeerJS's free public server is only used to introduce the two devices; the game moves go device to device.

## 1-player mode

Pick a level and tap **1 PLAYER GAME** to play the computer on one device (no connection needed once the page has loaded):

- **Easy:** fires at random (about 95 shots to sink your fleet).
- **Normal:** fires at random until it hits, then hunts that ship down (about 65 shots).
- **Hard:** works out where your remaining ships could fit and fires at the likeliest square (about 45 shots).

## Rules

- 10×10 grid, classic fleet: Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2).
- Ships may touch but not overlap.
- Players strictly alternate shots. The host fires first in round 1, then the first shot alternates each round.
- Red = hit, green = miss. Sinking a ship announces it to both players.
- Rematches keep a running win tally until someone leaves.

## Files

- `index.html`: page structure
- `style.css`: 8-bit look
- `game.js`: game logic, networking and generated sound effects

## Run locally

```bash
python3 -m http.server 8642
```

Then open http://localhost:8642 in two browser windows or on two devices on the same network.

## Deploy to GitHub Pages

Push this folder to a GitHub repository, then under **Settings → Pages** set the source to the `main` branch, root folder. The `.nojekyll` file stops GitHub from processing the files.

## Known limits

- If a phone goes to sleep or the page is closed, the connection drops and that game ends. The game asks the browser to keep the screen awake during play where supported.
- Some strict networks (certain corporate or mobile networks) can block peer-to-peer connections. PeerJS falls back to its public relay server, which usually gets round this.
