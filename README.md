# p8per

PICO-8 carts on paper. One letter sheet, folded in quarters: the cover is the cart image, and the
other quarters hold the whole game as black and white code that a phone reads back into the original
`.p8.png`. Each quarter is one tile of 0.4 mm modules, read and checked on its own. A cart takes
the tiles it needs: most fit the front's three (status, Mole Mole, pcraft), and bigger ones go on to
the back's four. Even the biggest cart PICO-8 can make (all 32 KB incompressible, under a noise
label: `carts/p8per-max.p8.png`) fits, with 30% error correction.

The console shows the sheet as printed, front and back side by side, tiles numbered:

    C 3 | 4 7
    1 2 | 5 6

Scanning, the screen under it shows the camera's view with a guide the shape of a tile; the first
target it reads says how many tiles the cart takes, and each turns green on the sheet as it decodes.

One static page, no build step, no dependencies:

- `index.html`: the console. Get a cart in by scanning a printed `.p8.pdf` or uploading a `.p8.png`,
  then download it as a `.p8.png`, or as a `.p8.pdf` to print.
- `p8per.js`: the codec. Encode, decode, the sweep scanner, PNG and PDF writers. The code format is
  described at the top of the file.
- `test.mjs`: round-trip tests, including a simulated sweep of phone video frames.

## Run

Serve the folder with any static server, for example:

    python3 -m http.server

The live camera needs HTTPS (or localhost). Hosting your own copy, set `SITE` at the top of
`index.html`'s script to its address: every printed sheet carries a QR code of it on the cover.

## Print

Print the `.p8.pdf` at 100% scale, best quality: one-sided, or if it has two pages, two-sided
(flip on long edge). Fold on the dotted lines, printed side out: bottom half back, then right half
back, so the cart is the cover. To scan, unfold it, tap Scan, and hold the phone so a quarter fills
the guide, one quarter after another; turn the sheet over if it says to. 1080p video is plenty.

## Test

    node test.mjs path/to/some.p8.png

## License

MIT: do what you like with it, keeping the copyright notice (LICENSE). PICO-8 is by Lexaloffle;
carts belong to their authors.
