// Tiny stack machine for make.fun's 32-bit stack ISA.
// For every instance under the input directory it runs the program and writes
// the bytes it produced plus its exit code under the output directory.
// Deterministic: no clock, no randomness; the only environment read is the
// input/output location, defaulting to /input and /output.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

// Opcode table, from the ISA: [byte, immediate length, values popped, values pushed].
const SPEC = [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0],
  [0x04, 0, 1, 2], [0x05, 0, 2, 2], [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1], [0x13, 0, 2, 1],
  [0x14, 0, 2, 1], [0x15, 0, 2, 1], [0x16, 0, 2, 1], [0x17, 0, 1, 1],
  [0x18, 0, 2, 1], [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1], [0x20, 0, 2, 1],
  [0x21, 0, 2, 1], [0x22, 0, 2, 1], [0x30, 2, 0, 0], [0x31, 2, 1, 0],
  [0x32, 2, 1, 0], [0x33, 2, 0, 0], [0x34, 0, 0, 0], [0x40, 0, 1, 1],
  [0x41, 0, 2, 0], [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1],
  [0x53, 0, 1, 0],
];
const IMM = new Uint8Array(256);
const POP = new Uint8Array(256);
const PSH = new Uint8Array(256);
const KNOWN = new Uint8Array(256);
for (const row of SPEC) {
  IMM[row[0]] = row[1];
  POP[row[0]] = row[2];
  PSH[row[0]] = row[3];
  KNOWN[row[0]] = 1;
}

// Runs one program on its input. Returns [bytes written, exit code 0-255].
function run(prog, inp) {
  const mem = new Int32Array(256);
  const stk = new Int32Array(256);
  const ret = new Int32Array(64);
  const out = new Uint8Array(65536);
  let sp = 0, rp = 0, ol = 0, ip = 0, pc = 0, steps = 0;
  const n = prog.length;
  const fin = (code) => [out.subarray(0, ol), code];
  for (;;) {
    if (steps === 1000000) return fin(10);
    if (pc < 0 || pc >= n) return fin(9);
    const op = prog[pc];
    if (!KNOWN[op]) return fin(5);
    const im = IMM[op];
    if (pc + im >= n) return fin(9);
    steps++;
    const nx = pc + 1 + im;
    const pops = POP[op], push = PSH[op];
    if (sp < pops) return fin(2);
    if (sp - pops + push > 256) return fin(3);
    pc = nx;
    switch (op) {
      case 0x00:
        return fin(0);
      case 0x01:
        stk[sp++] = (prog[nx - 1] << 24) >> 24;
        break;
      case 0x02:
        stk[sp++] = prog[nx - 4] | (prog[nx - 3] << 8) | (prog[nx - 2] << 16) | (prog[nx - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        stk[sp] = stk[sp - 1];
        sp++;
        break;
      case 0x05: {
        const t = stk[sp - 1];
        stk[sp - 1] = stk[sp - 2];
        stk[sp - 2] = t;
        break;
      }
      case 0x06:
        stk[sp] = stk[sp - 2];
        sp++;
        break;
      case 0x07: {
        const t = stk[sp - 3];
        stk[sp - 3] = stk[sp - 2];
        stk[sp - 2] = stk[sp - 1];
        stk[sp - 1] = t;
        break;
      }
      case 0x17:
        stk[sp - 1] = (-stk[sp - 1]) | 0;
        break;
      case 0x1b:
        stk[sp - 1] = ~stk[sp - 1];
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = stk[sp - 1];
        const a = stk[sp - 2];
        let r = 0;
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13:
            if (b === 0) return fin(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 0x14:
            if (b === 0) return fin(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 0x15:
            if (b === 0) return fin(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16:
            if (b === 0) return fin(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          case 0x22: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        }
        sp -= 2;
        stk[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((prog[nx - 2] | (prog[nx - 1] << 8)) << 16) >> 16;
        let go = true;
        if (op !== 0x30) {
          const v = stk[--sp];
          go = op === 0x31 ? v === 0 : v !== 0;
        }
        if (go) pc = nx + rel;
        break;
      }
      case 0x33:
        if (rp === 64) return fin(7);
        ret[rp++] = nx;
        pc = prog[nx - 2] | (prog[nx - 1] << 8);
        break;
      case 0x34:
        if (rp === 0) return fin(8);
        pc = ret[--rp];
        break;
      case 0x40: {
        const a = stk[sp - 1];
        if (a < 0 || a >= 256) return fin(6);
        stk[sp - 1] = mem[a];
        break;
      }
      case 0x41: {
        const a = stk[sp - 1];
        const v = stk[sp - 2];
        if (a < 0 || a >= 256) return fin(6);
        sp -= 2;
        mem[a] = v;
        break;
      }
      case 0x50: {
        const s = String(stk[sp - 1]);
        if (ol + s.length > 65536) return fin(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return fin(11);
        out[ol++] = stk[--sp] & 255;
        break;
      case 0x52:
        stk[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
        return fin(stk[--sp] & 255);
    }
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const dir = join(IN_DIR, id);
  let prog = new Uint8Array(0);
  let inp = new Uint8Array(0);
  try { prog = readFileSync(join(dir, "program.bin")); } catch { /* missing: empty program traps 9 */ }
  try { inp = readFileSync(join(dir, "input.bin")); } catch { /* missing: empty input */ }
  const [bytes, code] = run(prog, inp);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, "stdout.bin"), bytes);
  writeFileSync(join(OUT_DIR, id, "exit.txt"), String(code) + "\n");
}
