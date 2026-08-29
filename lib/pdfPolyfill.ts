/**
 * pdfjs-dist (via pdf-parse) touches browser globals at module load:
 * `new DOMMatrix()`, plus ImageData / Path2D when canvas is missing.
 *
 * On Hostinger, `@napi-rs/canvas` fails to load its native binding, so pdfjs
 * cannot polyfill these itself and crashes. We only extract text — never
 * render — so minimal stubs are enough.
 *
 * Call installPdfPolyfills() before importing pdf-parse / pdfjs-dist.
 */

type Matrix2D = [number, number, number, number, number, number];

class DOMMatrixStub {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: string | number[] | Float32Array | Float64Array | null) {
    if (!init) return;
    if (typeof init === 'string') {
      const m = init.match(/matrix\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(/[,\s]+/).map(Number);
        if (parts.length >= 6) this.assign(parts as Matrix2D);
      }
      return;
    }
    const arr = Array.from(init as ArrayLike<number>);
    if (arr.length >= 6) this.assign(arr as unknown as Matrix2D);
  }

  private assign([a, b, c, d, e, f]: Matrix2D): this {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  get is2D() {
    return true;
  }
  get isIdentity() {
    return (
      this.a === 1 &&
      this.b === 0 &&
      this.c === 0 &&
      this.d === 1 &&
      this.e === 0 &&
      this.f === 0
    );
  }
  get m11() {
    return this.a;
  }
  get m12() {
    return this.b;
  }
  get m21() {
    return this.c;
  }
  get m22() {
    return this.d;
  }
  get m41() {
    return this.e;
  }
  get m42() {
    return this.f;
  }

  multiply(other?: DOMMatrixStub) {
    if (!other) return this;
    const a = this.a * other.a + this.c * other.b;
    const b = this.b * other.a + this.d * other.b;
    const c = this.a * other.c + this.c * other.d;
    const d = this.b * other.c + this.d * other.d;
    const e = this.a * other.e + this.c * other.f + this.e;
    const f = this.b * other.e + this.d * other.f + this.f;
    return new DOMMatrixStub([a, b, c, d, e, f]);
  }
  translate(tx = 0, ty = 0) {
    return this.multiply(new DOMMatrixStub([1, 0, 0, 1, tx, ty]));
  }
  scale(sx = 1, sy = sx) {
    return this.multiply(new DOMMatrixStub([sx, 0, 0, sy, 0, 0]));
  }
  rotate() {
    return this;
  }
  inverse() {
    const { a, b, c, d, e, f } = this;
    const det = a * d - b * c;
    if (!det) return new DOMMatrixStub();
    return new DOMMatrixStub([
      d / det,
      -b / det,
      -c / det,
      a / det,
      (c * f - d * e) / det,
      (b * e - a * f) / det,
    ]);
  }
  toFloat32Array() {
    return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]);
  }
  toString() {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

class ImageDataStub {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  colorSpace = 'srgb';

  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight?: number,
    height?: number,
  ) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = widthOrHeight ?? 0;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight ?? 0;
      this.height = height ?? 0;
    }
  }
}

class Path2DStub {
  constructor(_path?: Path2DStub | string) {}
  addPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  arcTo() {}
  ellipse() {}
  rect() {}
}

function defineGlobal(name: string, value: unknown): void {
  if ((globalThis as Record<string, unknown>)[name] != null) return;
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  });
}

export function installPdfPolyfills(): void {
  defineGlobal('DOMMatrix', DOMMatrixStub);
  defineGlobal('ImageData', ImageDataStub);
  defineGlobal('Path2D', Path2DStub);
}

// Install on import so any static `import '@/lib/pdfPolyfill'` runs early.
installPdfPolyfills();
