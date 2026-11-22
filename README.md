# Pixel Arcade

Retro 8-bit games for kids, in the browser. No accounts, nothing to install, and it can be added to a phone or tablet home screen so it opens like an app.

Live at https://francoisbeyers.github.io/battleships/

## Games

| Game | 1 player | 2 players, 1 device | 2 devices |
|---|---|---|---|
| **Battleships** | vs computer (Easy / Normal / Hard) | yes, with a "pass the device, no peeking" screen | yes |
| **Four in a Row** | vs computer (Easy / Normal / Hard) | yes | yes |
| **Memory Pairs** | beat your best score | yes | yes |

- Players are colours (BLUE and PINK), so there's nothing to type.
- Battleships has a **Quick** 8×8 sea with 4 ships for shorter games, or the classic **Big** 10×10 with 5 ships.
- Memory Pairs comes in 12, 16 or 24 cards.

## Playing on two devices

One player taps **2 DEVICES → START A ROOM** and gets a 4-digit room number. The other player opens the same game, taps **2 DEVICES**, types the number and taps **JOIN ROOM** (or opens the invite link). The browsers connect directly using [PeerJS](https://peerjs.com/); its free public server only introduces the two devices.

## Offline

A service worker (`sw.js`) saves the whole arcade on the first visit. After that, 1-player games and 2 players on one device work with no signal. Two-device games need internet on both devices.

When releasing changes, bump `VERSION` in `sw.js` so devices pick up the new files (they update on the next visit after that).

## Files

- `index.html`: arcade home page and install help
- `battleships.html`, `four.html`, `memory.html`: one page per game
- `css/arcade.css`, `js/arcade.js`: shared look, sounds, pixel sprites, mode picker, pass-the-device screen and two-device connection
- `css/<game>.css`, `js/<game>.js`: each game's own rules and drawing
- `sw.js`, `manifest.webmanifest`, `icons/`: offline cache and home-screen install

## Run locally

```bash
python3 -m http.server 8642
```

Then open http://localhost:8642. The offline cache only switches on over https (the live site), so local testing always loads fresh files.

## Known limits

- In two-device games, if a screen goes to sleep or the page is closed, the link drops and that game ends. The games ask the browser to keep the screen on during play where supported.
- Some strict networks can block device-to-device connections. PeerJS falls back to a relay server, which usually gets round this.
