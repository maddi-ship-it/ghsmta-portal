import { rgb } from "pdf-lib";

// Mirrors the GHSMTA portal's dark-mode brand tokens for every printable PDF.
export const GHSMTA_PRINT = {
  midnight: rgb(7 / 255, 11 / 255, 23 / 255),
  navy: rgb(15 / 255, 23 / 255, 41 / 255),
  navySoft: rgb(25 / 255, 38 / 255, 65 / 255),
  gold: rgb(213 / 255, 177 / 255, 79 / 255),
  goldBright: rgb(242 / 255, 216 / 255, 137 / 255),
  goldSoft: rgb(251 / 255, 245 / 255, 224 / 255),
  ivory: rgb(247 / 255, 242 / 255, 232 / 255),
  ink: rgb(28 / 255, 37 / 255, 55 / 255),
  muted: rgb(94 / 255, 105 / 255, 126 / 255),
  line: rgb(211 / 255, 218 / 255, 229 / 255),
  row: rgb(246 / 255, 248 / 255, 251 / 255),
  white: rgb(1, 1, 1),
} as const;
