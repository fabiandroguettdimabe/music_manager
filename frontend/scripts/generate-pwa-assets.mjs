// Genera los assets binarios de la PWA que no se pueden versionar como texto:
//  - iconos PNG (192, 512 y 512 maskable) a partir de los SVG de public/
//  - silence.wav: pista silenciosa que "ancla" la MediaSession a nuestra página
//    cuando el audio suena por el IFrame de YouTube (ver App.jsx).
//
// Ejecutar tras cambiar los SVG:  npm run gen:assets
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function renderPng(svgFile, size, outFile) {
  const svg = readFileSync(join(pub, svgFile), 'utf8');
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  }).render().asPng();
  writeFileSync(join(pub, outFile), png);
  console.log(`  ${outFile}  (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

function writeSilentWav(outFile, seconds = 2, rate = 8000) {
  const samples = seconds * rate; // mono, 16-bit
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes); // Buffer.alloc rellena de ceros → silencio
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);      // subchunk1 size (PCM)
  buf.writeUInt16LE(1, 20);       // audio format PCM
  buf.writeUInt16LE(1, 22);       // canales = 1
  buf.writeUInt32LE(rate, 24);    // sample rate
  buf.writeUInt32LE(rate * 2, 28);// byte rate
  buf.writeUInt16LE(2, 32);       // block align
  buf.writeUInt16LE(16, 34);      // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  writeFileSync(join(pub, outFile), buf);
  console.log(`  ${outFile}  (${seconds}s, ${(buf.length / 1024).toFixed(1)} KB)`);
}

console.log('Generando assets PWA en public/ …');
renderPng('icon.svg', 192, 'icon-192.png');
renderPng('icon.svg', 512, 'icon-512.png');
renderPng('icon-maskable.svg', 512, 'icon-maskable-512.png');
writeSilentWav('silence.wav');
console.log('Listo.');
