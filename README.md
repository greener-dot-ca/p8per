# p8per

PICO-8 carts on paper. The front of the printed cart is the cart image; the back is the whole
game as an 8-colour code that a phone camera can read back into the original `.p8.png`.

One static page, no build step, no dependencies:

- `index.html`: the console. Load a cart by scanning a printed one or choosing a `.p8.png`
  (or a photo of a printed cart), then save it as `.p8.png` or as a `.p8.pdf` to print.
- `p8per.js`: the codec. Encode, decode, photo scanner, PNG and PDF writers. The code format is
  described at the top of the file.
- `test.mjs`: round-trip tests, including simulated phone photos.

## Run

Serve the folder with any static server, for example:

    python3 -m http.server

The live camera needs HTTPS (or localhost).

## Print

Print the `.p8.pdf` double-sided, flip on long edge, at 100% scale. Cut on the dotted lines.
Two carts per letter sheet.

## Test

    node test.mjs path/to/some.p8.png
