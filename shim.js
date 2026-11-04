if (typeof __dirname === 'undefined') global.__dirname = '/';
if (typeof __filename === 'undefined') global.__filename = '';
if (typeof process === 'undefined') {
  global.process = require('process');
} else {
  const bProcess = require('process');
  for (var p in bProcess) {
    if (!(p in process)) {
      process[p] = bProcess[p];
    }
  }
}

process.browser = false;
if (typeof Buffer === 'undefined') global.Buffer = require('buffer').Buffer;

// Hermes does not honour Symbol.species on typed arrays, so the `buffer`
// package's inherited Uint8Array#subarray returns a plain Uint8Array there,
// not a Buffer, and `.toString('hex')` on it yields "51,68,…" instead of hex.
// The AA SDK derives signer addresses with `buf.subarray(-20).toString('hex')`,
// so Key's EVM partial signature was keyed under a garbage address and
// SDK 1.5.0 rejected it ("Signature from unknown signer"). Return a real
// Buffer, as @craftzdog/react-native-buffer does. defineProperty rather than
// assignment: SES lockdown freezes Uint8Array.prototype, and assigning a
// shadowing property would hit the override mistake.
(function ensureBufferSubarray(B) {
  if (B.from([1, 2, 3]).subarray(1) instanceof B) return;
  Object.defineProperty(B.prototype, 'subarray', {
    value: function subarray(start, end) {
      const view = Uint8Array.prototype.subarray.call(this, start, end);
      Object.setPrototypeOf(view, B.prototype);
      return view;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
})(global.Buffer);

// global.location = global.location || { port: 80 }
// eslint-disable-next-line no-undef
const isDev = typeof __DEV__ === 'boolean' && __DEV__;
process.env['NODE_ENV'] = isDev ? 'development' : 'production';
if (typeof localStorage !== 'undefined') {
  localStorage.debug = isDev ? '*' : '';
}

// If using the crypto shim, uncomment the following line to ensure
// crypto is loaded first, so it can populate global.crypto
// require('crypto')
